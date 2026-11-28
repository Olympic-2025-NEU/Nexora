// SPDX-License-Identifier: AGPL-3.0-only
// Pair each sender's secret with the receiver's Keycloak client. Never print secrets.
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

if (process.env.DEMO_ONLY !== "true") throw new Error("DEMO_ONLY=true required");
const root = resolve(import.meta.dirname, "../..");
const files = Object.fromEntries("abc".split("").map((instance) =>
  [instance, resolve(root, "deploy", "instances", `${instance}.env`)]));
const texts = Object.fromEntries(Object.entries(files).map(([instance, path]) =>
  [instance, readFileSync(path, "utf8")]));
const values = Object.fromEntries(Object.entries(texts).map(([instance, value]) =>
  [instance, parseEnv(value)]));
for (const instance of "abc") {
  if (values[instance].INSTANCE_ID !== instance)
    throw new Error(`Instance identity mismatch: ${instance}`);
}
const edges = [
  { sender: "a", receiver: "b", outbound: 1, inbound: 1 },
  { sender: "b", receiver: "a", outbound: 1, inbound: 1 },
  { sender: "b", receiver: "c", outbound: 2, inbound: 1 },
  { sender: "c", receiver: "b", outbound: 1, inbound: 2 },
];
function ensure(instance, name, desired) {
  const current = values[instance][name];
  if (current && current !== desired) throw new Error(`Conflicting ${name} for ${instance}`);
  if (current) return;
  texts[instance] += `\n${name}=${desired}\n`;
  values[instance][name] = desired;
}
for (const edge of edges) {
  const clientId = `nexora-${edge.sender}-to-${edge.receiver}`;
  const outgoingId = `FEDERATION_OUTBOUND_CLIENT_${edge.outbound}_ID`;
  const incomingId = `FEDERATION_INBOUND_CLIENT_${edge.inbound}_ID`;
  const outgoingSecret = `FEDERATION_OUTBOUND_SECRET_${edge.outbound}`;
  const incomingSecret = `FEDERATION_INBOUND_CLIENT_${edge.inbound}_SECRET`;
  const senderSecret = values[edge.sender][outgoingSecret];
  const receiverSecret = values[edge.receiver][incomingSecret];
  if (senderSecret && receiverSecret && senderSecret !== receiverSecret)
    throw new Error(`Secret mismatch for ${clientId}`);
  const secret = senderSecret || receiverSecret || randomBytes(32).toString("hex");
  ensure(edge.sender, outgoingId, clientId);
  ensure(edge.receiver, incomingId, clientId);
  ensure(edge.sender, outgoingSecret, secret);
  ensure(edge.receiver, incomingSecret, secret);
}
for (const instance of "abc")
  writeFileSync(files[instance], texts[instance], { mode: 0o600 });
console.log("Prepared four receiver-issued M2M clients across A/B/C; secrets remain in ignored env files.");
