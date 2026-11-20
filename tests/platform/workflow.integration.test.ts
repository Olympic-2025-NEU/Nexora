// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { FlowableClient, FlowableHttpError, type ProcessInstance } from "../../platform/workflow/flowable-client";

const env = process.env;
const instance = env.FLOWABLE_INSTANCE ?? "a";
const project = env.FLOWABLE_PROJECT ?? `nexora-${instance}`;
const host = `http://127.0.0.1:${env.FLOWABLE_HOST_PORT}/flowable-rest/service`;
const auth = `Basic ${Buffer.from(`${env.FLOWABLE_ADMIN_USER}:${env.FLOWABLE_ADMIN_PASSWORD}`).toString("base64")}`;
const client = new FlowableClient({ baseUrl: `http://127.0.0.1:${env.FLOWABLE_HOST_PORT}`, user: env.FLOWABLE_ADMIN_USER!, password: env.FLOWABLE_ADMIN_PASSWORD! });
const compose = ["compose", "-f", "deploy/compose.yml", "--env-file", `deploy/instances/${instance}.env`, "-p", project];
function docker(args: string[], options: { stdio?: "inherit"; encoding?: "utf8" } = {}) {
  return execFileSync("bash", ["-c", 'docker "$@"', "bash", ...args], options);
}

async function poll<T>(check: () => Promise<T | false>, timeout = 120000): Promise<T> {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { const result = await check(); if (result) return result; } catch (error) {
      if (!(error instanceof FlowableHttpError && error.status === 404) && !(error instanceof TypeError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Flowable polling deadline exceeded");
}

async function start(): Promise<ProcessInstance> {
  const id = randomUUID();
  return client.startProcess({ businessKey: id, variables: {
    approvalRequestId: id, documentId: randomUUID(), creatorSub: "creator", warehouseIds: ["warehouse-a"],
    submittedAt: new Date().toISOString(), submittedDocumentVersion: 1, lineSnapshotSha256: "a".repeat(64),
  } });
}

async function taskFor(id: string) {
  return poll(async () => (await client.queryTasks({ candidateGroup: "approver", processInstanceId: id })).find((task) => task.processInstanceId === id && task.taskDefinitionKey === "approveGoodsIssue") || false);
}

async function finished(id: string, end: string, decision: string, reason?: string) {
  const history = await poll(async () => {
    const row = await client.getHistory(id);
    return row.endTime && row.endActivityIds.includes(end) ? row : false;
  });
  assert.deepEqual(history.endActivityIds, [end]);
  assert.equal(history.variables.find((row) => row.name === "decision")?.value, decision);
  if (reason) assert.equal(history.variables.find((row) => row.name === "decisionReason")?.value, reason);
  await assert.rejects(client.getInstance(id), (error: unknown) => error instanceof FlowableHttpError && error.status === 404);
}

test("Flowable PostgreSQL lifecycle, version upgrade and restart", { timeout: 360000 }, async () => {
  const health = await fetch(`${host}/management/engine`, { headers: { authorization: auth } });
  assert.equal(health.status, 200);
  for (const user of ["admin", "rest-admin"]) {
    const denied = await fetch(`${host}/management/engine`, { headers: { authorization: `Basic ${Buffer.from(`${user}:test`).toString("base64")}` } });
    assert.equal(denied.status, 401);
  }
  const tables = docker([...compose, "exec", "-T", "postgres", "psql", "-X", "-tA", "-v", "ON_ERROR_STOP=1", "-U", env.POSTGRES_USER!, "-d", env.FLOWABLE_DB_NAME!, "-c", "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'act\\_%' ESCAPE '\\'"], { encoding: "utf8" });
  assert.ok(Number(String(tables).trim()) > 0);
  assert.equal((await client.latestDefinition())?.version, 1);

  for (const [decision, end, reason] of [["approved", "approvedEnd", undefined], ["rejected", "rejectedEnd", "damaged lot"]] as const) {
    const process = await start();
    assert.equal((await client.getInstance(process.id)).id, process.id);
    assert.equal((await client.findInstanceByBusinessKey(process.businessKey))?.id, process.id);
    const task = await taskFor(process.id);
    await client.completeTask(task.id, { decision, decisionReason: reason, approverSub: "approver", decidedAt: new Date().toISOString() });
    await finished(process.id, end, decision, reason);
  }

  const cancelled = await start();
  await taskFor(cancelled.id);
  await client.cancelProcess(cancelled.id, "cancelled by owner");
  const cancelledHistory = await poll(async () => { const row = await client.getHistory(cancelled.id); return row.endTime ? row : false; });
  assert.equal(cancelledHistory.deleteReason, "cancelled by owner");
  await assert.rejects(client.getInstance(cancelled.id), (error: unknown) => error instanceof FlowableHttpError && error.status === 404);
  assert.equal((await client.findInstanceByBusinessKey(cancelled.businessKey))?.id, cancelled.id);

  const old = await start();
  const oldTask = await taskFor(old.id);
  assert.equal(oldTask.name, "Approve goods issue");
  execFileSync("bash", ["deploy/scripts/deploy-flowable.sh", instance, project, "--force", "tests/platform/goods-issue-approval-v2.bpmn20.xml"], { stdio: "inherit" });
  assert.equal((await client.latestDefinition())?.version, 2);
  const newer = await start();
  assert.equal((await taskFor(newer.id)).name, "Approve goods issue v2");
  assert.equal((await taskFor(old.id)).name, "Approve goods issue");
  await client.completeTask(oldTask.id, { decision: "approved", approverSub: "approver", decidedAt: new Date().toISOString() });
  await finished(old.id, "approvedEnd", "approved");
  const newTask = await taskFor(newer.id);
  await client.completeTask(newTask.id, { decision: "approved", approverSub: "approver", decidedAt: new Date().toISOString() });
  await finished(newer.id, "approvedEnd", "approved");

  const durable = await start();
  const durableTask = await taskFor(durable.id);
  docker([...compose, "restart", "flowable"], { stdio: "inherit" });
  await poll(async () => { try { const response = await fetch(`${host}/management/engine`, { headers: { authorization: auth }, signal: AbortSignal.timeout(3000) }); return response.ok; } catch { return false; } });
  assert.equal((await taskFor(durable.id)).id, durableTask.id);
  await client.completeTask(durableTask.id, { decision: "approved", approverSub: "approver", decidedAt: new Date().toISOString() });
  await finished(durable.id, "approvedEnd", "approved");
});
