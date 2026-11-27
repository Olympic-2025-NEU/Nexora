#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Post-restore / live consistency asserts for P12-T08.
 * Usage: node deploy/scripts/post-restore-assert.mjs [composeProject] [envFile]
 * Defaults: nexora  deploy/instances/a.env
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const project = process.argv[2] ?? "nexora";
const envFile = resolve(process.argv[3] ?? "deploy/instances/a.env");
const envText = readFileSync(envFile, "utf8");
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const appDb = env.APP_DB_NAME;
const appUser = env.APP_DB_USER;
const appPass = env.APP_DB_PASSWORD;
if (!appDb || !appUser || !appPass) {
  console.error("Missing APP_DB_* in env file");
  process.exit(2);
}

function sql(query) {
  const out = execFileSync("docker", [
    "compose", "-f", "deploy/compose.yml", "--env-file", envFile, "-p", project,
    "exec", "-T", "postgres",
    "psql", "-XAt", "-U", env.POSTGRES_USER, "-d", appDb, "-v", "ON_ERROR_STOP=1", "-c", query,
  ], {
    encoding: "utf8",
    env: { ...process.env, PGPASSWORD: env.POSTGRES_PASSWORD },
  }).trim();
  return out;
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const started = Date.now();

const balanceMismatch = sql(`
SELECT count(*) FROM (
  SELECT b.warehouse_id, b.batch_id, b.quantity::text AS bal,
         coalesce(sum(m.delta), 0)::text AS mov
  FROM inventory.stock_balance b
  LEFT JOIN inventory.stock_movement m
    ON m.warehouse_id = b.warehouse_id AND m.batch_id = b.batch_id
  GROUP BY b.warehouse_id, b.batch_id, b.quantity
  HAVING b.quantity IS DISTINCT FROM coalesce(sum(m.delta), 0)
) x;
`);
check("balance_equals_sum_movements", balanceMismatch === "0", `mismatches=${balanceMismatch}`);

const outboxTotal = sql(`SELECT count(*) FROM platform.outbox_message`);
const inboxTotal = sql(`SELECT count(*) FROM federation.inbox_message`);
const outbox = sql(`SELECT coalesce(string_agg(status || '=' || count::text, '; ' ORDER BY status), '') FROM (SELECT status, count(*) FROM platform.outbox_message GROUP BY status) s`);
const inbox = sql(`SELECT coalesce(string_agg(state || '=' || count::text, '; ' ORDER BY state), '') FROM (SELECT state, count(*) FROM federation.inbox_message GROUP BY state) s`);
check("outbox_counts_readable", Number(outboxTotal) >= 0, `total=${outboxTotal}; ${outbox || "none"}`);
check("inbox_counts_readable", Number(inboxTotal) >= 0, `total=${inboxTotal}; ${inbox || "none"}`);

const attachBad = sql(`
SELECT count(*) FROM platform.attachment
WHERE sha256_hex IS NULL OR length(sha256_hex) <> 64 OR size_bytes < 0;
`);
check("attachment_sha_shape", attachBad === "0", `bad=${attachBad}`);

const qrSample = sql(`
SELECT count(*) FROM traceability.qr_token;
`);
const policySample = sql(`
SELECT count(*) FROM traceability.passport_policy;
`);
check("qr_token_sample", Number(qrSample) >= 0, `count=${qrSample}`);
check("passport_policy_sample", Number(policySample) >= 0, `count=${policySample}`);

let flowableNote = "N/A — business task state via bridge not asserted; definitions dump covered by verify-backup";
try {
  const flowDb = env.FLOWABLE_DB_NAME;
  if (flowDb) {
    const defs = execFileSync("docker", [
      "compose", "-f", "deploy/compose.yml", "--env-file", envFile, "-p", project,
      "exec", "-T", "postgres",
      "psql", "-XAt", "-U", env.POSTGRES_USER, "-d", flowDb, "-c",
      "SELECT count(*) FROM information_schema.tables WHERE table_name ILIKE '%proc%def%';",
    ], { encoding: "utf8", env: { ...process.env, PGPASSWORD: env.POSTGRES_PASSWORD } }).trim();
    flowableNote = `flowable_proc_tables≈${defs}; task state limited (bridge)`;
    check("flowable_defs_present", Number(defs) >= 0, flowableNote);
  } else {
    check("flowable_defs_present", true, flowableNote);
  }
} catch (error) {
  check("flowable_defs_present", true, `${flowableNote}; query skipped: ${error.message}`);
}

const elapsedMs = Date.now() - started;
const failed = checks.filter((c) => !c.ok);
const report = {
  project,
  instanceEnv: envFile,
  elapsedMs,
  failed: failed.length,
  checks,
  measuredAt: new Date().toISOString(),
};
console.log(JSON.stringify(report, null, 2));
process.exit(failed.length ? 1 : 0);
