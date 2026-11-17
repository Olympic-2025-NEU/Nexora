// SPDX-License-Identifier: AGPL-3.0-only
import { validateConfig } from "../deploy/config.mjs";
validateConfig(process.env, "worker");
// Outbox/worker loop lands in P04. Stub keeps process alive for Compose profile apps.
console.log(JSON.stringify({ service: "nexora-worker", status: "stub", note: "P04 outbox not implemented" }));
setInterval(() => {}, 60_000);
