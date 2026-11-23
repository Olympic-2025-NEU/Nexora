// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { FlowableClient, FlowableHttpError, FlowableUnknownOutcomeError } from "./flowable-client";

test("Flowable REST shapes, auth, reconciliation and decision validation", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("runtime/process-instances?")) return Response.json({ data: [] });
    if (url.includes("history/historic-process-instances?")) return Response.json({ data: [{ id: "historic" }] });
    if (init.method === "POST" && url.includes("runtime/tasks/")) return new Response(null, { status: 204 });
    return Response.json({ id: "instance", data: [] });
  }) as typeof fetch;
  const client = new FlowableClient({ baseUrl: "http://flowable:8080", user: "service", password: "secret" }, transport);
  const variables = { approvalRequestId: "request", documentId: "document", creatorSub: "creator", warehouseIds: ["warehouse"], submittedAt: "now", submittedDocumentVersion: 1, lineSnapshotSha256: "hash" };
  assert.equal((await client.startProcess({ businessKey: "request", variables })).id, "instance");
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { processDefinitionKey: "goods-issue-approval", businessKey: "request", variables: Object.entries(variables).map(([name, value]) => ({ name, value })) });
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, `Basic ${Buffer.from("service:secret").toString("base64")}`);
  assert.ok(calls[0].url.endsWith("/flowable-rest/service/runtime/process-instances"));
  assert.equal((await client.findInstanceByBusinessKey("request"))?.id, "historic");
  const before = calls.length;
  assert.throws(() => client.completeTask("task", { decision: "rejected", decisionReason: "  ", approverSub: "approver", decidedAt: "now" }));
  assert.equal(calls.length, before);
  await client.completeTask("task", { decision: "rejected", decisionReason: "damage", approverSub: "approver", decidedAt: "now" });
  assert.deepEqual(JSON.parse(calls.at(-1)!.init.body as string).variables.map((v: { name: string }) => v.name), ["decision", "approverSub", "decidedAt", "decisionReason"]);
});

test("POST network failure has unknown outcome; HTTP errors retain status", async () => {
  const variables = { approvalRequestId: "request", documentId: "document", creatorSub: "creator", warehouseIds: [], submittedAt: "now", submittedDocumentVersion: 1, lineSnapshotSha256: "hash" };
  let calls = 0;
  const client = new FlowableClient({ baseUrl: "http://flowable:8080", user: "service", password: "secret" }, (async () => { calls++; throw new Error("connection lost"); }) as typeof fetch);
  await assert.rejects(client.startProcess({ businessKey: "request", variables }), FlowableUnknownOutcomeError);
  assert.equal(calls, 1);
  const failed = new FlowableClient({ baseUrl: "http://flowable:8080", user: "service", password: "secret" }, (async () => new Response(null, { status: 401 })) as typeof fetch);
  await assert.rejects(failed.latestDefinition(), (error: unknown) => error instanceof FlowableHttpError && error.status === 401);
});
