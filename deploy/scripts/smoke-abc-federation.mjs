// SPDX-License-Identifier: AGPL-3.0-only
// Run inside the sending demo worker: node /tmp/smoke-abc-federation.mjs a b 1
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const [sender, receiver, slot] = process.argv.slice(2);
if (process.env.DEMO_ONLY !== "true" || !["a", "b", "c"].includes(sender) ||
    !["a", "b", "c"].includes(receiver) || !["1", "2"].includes(slot))
  throw new Error("DEMO_ONLY=true and sender/receiver a|b|c plus secret slot 1|2 required");
const clientId = `nexora-${sender}-to-${receiver}`;
const clientSecret = process.env[`FEDERATION_OUTBOUND_SECRET_${slot}`];
assert.ok(clientSecret, "Missing outbound secret in sending worker");
const base = `https://gateway-${receiver}.nexora.test:9443`;
const tokenResponse = await fetch(`${base}/realms/nexora/protocol/openid-connect/token`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId,
    client_secret: clientSecret }),
});
assert.equal(tokenResponse.status, 200, `Token endpoint returned ${tokenResponse.status}`);
const { access_token: token } = await tokenResponse.json();
assert.ok(token, "Token endpoint did not return an access token");
const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
const browserPort = { a: 18080, b: 18081, c: 18082 }[receiver];
assert.equal(claims.iss, `http://127.0.0.1:${browserPort}/realms/nexora`);
assert.equal(claims.azp, clientId);
assert.ok([claims.aud].flat().includes("erp-browser"));
assert.ok(claims.scope.split(" ").includes("federation:write"));

const now = new Date().toISOString();
const batchId = randomUUID();
const envelope = {
  schemaVersion: "1.0", messageId: randomUUID(), eventId: randomUUID(),
  eventType: "transfer.announced.v1", issuerInstanceId: `nexora-${sender}`,
  recipientInstanceId: `nexora-${receiver}`, occurredAt: now, publishedAt: now,
  correlationId: randomUUID(), causationId: randomUUID(),
  sourceDocument: { type: "partner_transfer", id: randomUUID(), version: 2 },
  lots: [{ sourceLineId: randomUUID(),
    originLot: { issuerInstanceId: `nexora-${sender}`, lotId: batchId },
    senderBatch: { instanceId: `nexora-${sender}`, batchId },
    product: { instanceId: `nexora-${sender}`, productId: randomUUID() },
    quantity: "1", unit: "EA" }],
  upstreamReferences: [], evidence: [], sharingPolicyVersion: "v1",
  linkedIssueId: randomUUID(), sentQuantity: "1",
};
const body = JSON.stringify(envelope);
async function send() {
  const response = await fetch(`${base}/api/v1/federation/events`, {
    method: "POST", headers: { authorization: `Bearer ${token}`,
      "content-type": "application/json" }, body,
  });
  const result = await response.json();
  assert.equal(response.status, 202, `Event endpoint returned ${response.status}: ${result.code ?? "unknown"}`);
  return result;
}
const first = await send();
const replay = await send();
assert.equal(first.messageId, envelope.messageId);
assert.equal(first.ackId, replay.ackId);
assert.equal(first.status, "pending_dependency");
console.log(JSON.stringify({ direction: `${sender}->${receiver}`, tokenStatus: tokenResponse.status,
  eventStatus: 202, ackStatus: first.status, replaySameAck: true,
  messageId: envelope.messageId }));
