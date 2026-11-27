#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Lightweight client-side latency sampler for demo SLO evidence.
 * Usage: node deploy/scripts/slo-load.mjs [baseUrl] [n]
 * Defaults: http://127.0.0.1:8080 40
 */
import { performance } from "node:perf_hooks";

const base = (process.argv[2] ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const n = Math.min(200, Math.max(5, Number(process.argv[3] ?? 40)));
const paths = [
  "/api/v1/metrics",
  "/api/v1/health/live",
  "/api/v1/health/ready",
];

async function sample(path) {
  const url = `${base}${path}`;
  const t0 = performance.now();
  let status = 0;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/plain, application/json",
        "x-correlation-id": `slo-load-${Date.now()}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    await res.arrayBuffer();
  } catch {
    status = 0;
  }
  return { path, status, ms: performance.now() - t0 };
}

const results = [];
for (let i = 0; i < n; i += 1) {
  const path = paths[i % paths.length];
  results.push(await sample(path));
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

const ok = results.filter((r) => r.status > 0 && r.status < 500);
const byPath = Object.fromEntries(paths.map((path) => {
  const ms = ok.filter((r) => r.path === path).map((r) => r.ms);
  return [path, {
    samples: ms.length,
    p50_ms: percentile(ms, 0.5),
    p95_ms: percentile(ms, 0.95),
    max_ms: ms.length ? Math.max(...ms) : null,
  }];
}));

const report = {
  base,
  requested: n,
  ok: ok.length,
  failed: results.length - ok.length,
  overall_p95_ms: percentile(ok.map((r) => r.ms), 0.95),
  byPath,
  measuredAt: new Date().toISOString(),
  note: "Client-side wall times on this host — not a fabricated SLO target.",
};

console.log(JSON.stringify(report, null, 2));
