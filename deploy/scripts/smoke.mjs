// SPDX-License-Identifier: AGPL-3.0-only
import { bucketProbe } from "/health.mjs";

const checks = [
  ["gateway", "http://gateway:9080/gateway/ping"],
  ["keycloak", "http://keycloak:8080/realms/nexora/.well-known/openid-configuration"],
  ["core-data", "http://core-data:8080/api/v1/health/ready"],
  ["erp", "http://erp:3000/api/v1/health/ready"],
  ["worker", "http://worker:8081/health/ready"],
];
let failed = false;
for (const [name, url] of checks) {
  try {
    const result = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!result.ok) throw Error("unavailable");
    console.log(`${name}: up`);
  } catch { console.log(`${name}: down`); failed = true; }
}
try {
  const result = await fetch("http://flowable:8080/flowable-rest/service/management/engine", {
    headers: { authorization: `Basic ${Buffer.from(`${process.env.FLOWABLE_ADMIN_USER}:${process.env.FLOWABLE_ADMIN_PASSWORD}`).toString("base64")}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!result.ok) throw Error("unavailable");
  const definition = await fetch("http://flowable:8080/flowable-rest/service/repository/process-definitions?key=goods-issue-approval&latest=true", {
    headers: { authorization: `Basic ${Buffer.from(`${process.env.FLOWABLE_ADMIN_USER}:${process.env.FLOWABLE_ADMIN_PASSWORD}`).toString("base64")}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!definition.ok || !(await definition.json()).data?.some((row) => row.key === "goods-issue-approval")) throw Error("definition missing");
  console.log("flowable: up; goods-issue-approval: deployed");
} catch { console.log("flowable: down"); failed = true; }
try {
  await bucketProbe(process.env);
  console.log("storage: up");
} catch { console.log("storage: down"); failed = true; }
process.exitCode = Number(failed);
