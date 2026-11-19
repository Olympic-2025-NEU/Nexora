// SPDX-License-Identifier: AGPL-3.0-only
/** Headless core smoke. Run after stopping ERP, DX-Lab and worker; never manages services. */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const instance = process.argv[2] || 'a';
const results = [];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const mask = (id) => `…${id.slice(-6)}`;
const blocked = (reason) => { throw new Blocked(reason); };
class Blocked extends Error {}

async function step(name, run) {
  try {
    const detail = await run();
    results.push({ name, state: 'PASS', detail });
  } catch (error) {
    results.push({ name, state: error instanceof Blocked ? 'BLOCKED' : 'FAIL',
      detail: error.message });
  }
  const last = results.at(-1);
  console.log(`${name}\t${last.state}\t${last.detail}`);
}

function docker(container, command, input) {
  // Never print Docker stderr: it may contain credentials or request data.
  try {
    return execFileSync('docker', ['exec', ...(input === undefined ? [] : ['-i']),
      `${project}-${container}-1`, ...command],
    { encoding: 'utf8', input, timeout: 15000, maxBuffer: 1024 * 1024 });
  } catch { throw new Error(`${container} exec unavailable`); }
}

const internalFetch = `
const { url, form } = JSON.parse(require('fs').readFileSync(0, 'utf8'));
fetch(url, { ...(form ? { method: 'POST', body: new URLSearchParams(form) } : {}),
  signal: AbortSignal.timeout(10000) }).then(async response => {
  const body = form && response.ok ? await response.json() : {};
  process.stdout.write(JSON.stringify({ status: response.status, access_token: body.access_token }));
}).catch(() => process.stdout.write(JSON.stringify({ status: 0 })));
`;
function keycloak(url, form) {
  const output = docker('core-data', ['node', '-e', internalFetch], JSON.stringify({ url, form }));
  try { return JSON.parse(output); }
  catch { throw new Error('Keycloak response invalid'); }
}

function expectStatus(response, status) {
  if (response.status !== status) throw new Error(`HTTP ${response.status}, expected ${status}`);
  return response;
}
async function json(response) {
  try { return await response.json(); }
  catch { throw new Error('JSON response invalid'); }
}
async function recordsResponse(response, status) {
  if (response.status === 401 && (await json(response)).code === 'TOKEN_INVALID') blocked('token audience');
  return expectStatus(response, status);
}
async function filesResponse(response, status) {
  if (response.status === 401 && (await json(response)).code === 'TOKEN_INVALID') blocked('token audience');
  return expectStatus(response, status);
}

let env;
let project;
let base;
try {
  if (!/^[a-z0-9-]+$/.test(instance)) throw new Error('Invalid instance');
  const deploy = fileURLToPath(new URL('../', import.meta.url));
  env = parseEnv(readFileSync(resolve(deploy, 'instances', `${instance}.env`), 'utf8'));
  project = `nexora-${instance}`;
  // Gateway HTTP is bound to host loopback; HTTPS may use a private local CA.
  base = `http://127.0.0.1:${env.GATEWAY_HTTP_PORT || '19080'}`;
} catch {
  console.log('config\tFAIL\tinstance env unavailable');
  console.log('\nStep\tResult\tDetail\nconfig\tFAIL\tinstance env unavailable');
  process.exitCode = 1;
}

if (env) {
  const request = (path, init) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(10000) });
  let token;
  let fileId;
  let memberId;
  let recordId;
  const content = Buffer.from(`Nexora headless smoke ${randomUUID()}\n`, 'utf8');
  const fileHash = createHash('sha256').update(content).digest('hex');

  await step('gateway ping', async () => {
    const response = await request('/gateway/ping');
    expectStatus(response, 200);
    return `HTTP ${response.status}`;
  });
  await step('SSO discovery', () => {
    const response = keycloak(`${env.OIDC_ISSUER_URL}/.well-known/openid-configuration`);
    expectStatus(response, 200);
    return `HTTP ${response.status}`;
  });
  await step('SSO dev token', () => {
    if (!env.KC_DEV_USERNAME || !env.KC_DEV_USER_PASSWORD) throw new Error('dev credentials missing');
    const response = keycloak(`${env.OIDC_ISSUER_URL}/protocol/openid-connect/token`, {
      grant_type: 'password', client_id: env.OIDC_CLIENT_ID_ERP || 'erp-browser',
      username: env.KC_DEV_USERNAME, password: env.KC_DEV_USER_PASSWORD,
    });
    expectStatus(response, 200);
    if (!response.access_token) throw new Error('access token missing');
    token = response.access_token;
    return `HTTP ${response.status}`;
  });
  await step('Flowable management', () => {
    // Same internal endpoint and credentials as Compose healthcheck; wget prints only headers.
    const output = docker('flowable', ['sh', '-c',
      'auth=$(printf "%s:%s" "$FLOWABLE_REST_APP_ADMIN_USER_ID" "$FLOWABLE_REST_APP_ADMIN_PASSWORD" | base64 -w0); wget -S -O /dev/null --header "Authorization: Basic $auth" http://127.0.0.1:8080/flowable-rest/service/management/engine 2>&1; true']);
    const status = Number(output.match(/HTTP\/\S+\s+(\d{3})/)?.[1] || 0);
    expectStatus({ status }, 200);
    return `HTTP ${status}`;
  });
  await step('core ready', () => {
    // services/core-data/server.js registers /api/v1/health/ready (health.mjs is absent in this checkout).
    const output = docker('core-data', ['node', '-e',
      'fetch("http://127.0.0.1:8080/api/v1/health/ready", { signal: AbortSignal.timeout(10000) }).then(r => process.stdout.write(String(r.status)))']);
    const status = Number(output.trim());
    expectStatus({ status }, 200);
    return `HTTP ${status}`;
  });

  await step('files no token', async () => {
    const body = new FormData();
    body.set('file', new Blob([content], { type: 'text/plain' }), 'smoke.txt');
    const response = await request('/api/v1/files', { method: 'POST', body });
    expectStatus(response, 401);
    return `HTTP ${response.status}`;
  });
  await step('records no token', async () => {
    const response = await request('/api/v1/core/records', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' });
    expectStatus(response, 401);
    return `HTTP ${response.status}`;
  });

  await step('file upload', async () => {
    if (!token) blocked('dev token unavailable');
    const body = new FormData();
    body.set('file', new Blob([content], { type: 'text/plain' }), 'smoke.txt');
    const response = await request('/api/v1/files', { method: 'POST', body,
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() } });
    await filesResponse(response, 202);
    fileId = (await json(response)).data?.id;
    if (!uuid.test(fileId ?? '')) throw new Error('file ID missing');
    return `HTTP ${response.status} id=${mask(fileId)}`;
  });
  await step('file scan clean', async () => {
    if (!fileId) blocked('upload unavailable');
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const response = await request(`/api/v1/files/${fileId}`, {
        headers: { Authorization: `Bearer ${token}` } });
      await filesResponse(response, 200);
      const data = (await json(response)).data;
      if (data?.scanState === 'clean') {
        if (data.checksum !== fileHash) throw new Error('metadata SHA-256 mismatch');
        return `HTTP ${response.status} id=${mask(fileId)} checksum=${fileHash.slice(0, 12)}`;
      }
      if (data?.scanState === 'infected' || data?.scanState === 'error') {
        throw new Error(`scanState ${data.scanState}`);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error('scan timeout 120s');
  });
  await step('file download', async () => {
    if (!fileId || results.at(-1).state !== 'PASS') blocked('clean file unavailable');
    const response = await request(`/api/v1/files/${fileId}?download=1`, {
      headers: { Authorization: `Bearer ${token}` } });
    await filesResponse(response, 200);
    const checksum = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
    if (checksum !== fileHash) throw new Error('download SHA-256 mismatch');
    return `HTTP ${response.status} checksum=${checksum.slice(0, 12)}`;
  });

  await step('membership lookup', () => {
    if (!token) blocked('dev token unavailable');
    let sub;
    try { sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub; }
    catch { throw new Error('token subject invalid'); }
    if (!uuid.test(sub ?? '')) throw new Error('token subject invalid');
    const output = docker('postgres', ['psql', '-X', '-A', '-t', '-U', env.POSTGRES_USER,
      '-d', env.APP_DB_NAME],
    `SELECT id FROM system.membership WHERE keycloak_sub = '${sub}' AND status = 'active';\n`);
    memberId = output.trim();
    if (!memberId) blocked('active membership unavailable');
    if (!uuid.test(memberId)) throw new Error('membership ID invalid');
    return `id=${mask(memberId)}`;
  });
  const evidence = () => ({ kind: 'evidence_metadata', payload: {
    schemaVersion: 1, ownerType: 'membership', ownerId: memberId,
    attachmentId: fileId, title: 'Headless core smoke',
  } });
  await step('record create', async () => {
    if (!memberId || !fileId || results.find(r => r.name === 'file download')?.state !== 'PASS') {
      blocked('clean attachment or membership unavailable');
    }
    const response = await request('/api/v1/core/records', { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json',
        'Idempotency-Key': randomUUID() }, body: JSON.stringify(evidence()) });
    await recordsResponse(response, 201);
    recordId = (await json(response)).data?.id;
    if (!uuid.test(recordId ?? '')) throw new Error('record ID missing');
    return `HTTP ${response.status} id=${mask(recordId)}`;
  });
  await step('record get', async () => {
    if (!recordId) blocked('record create unavailable');
    const response = await request(`/api/v1/core/records/${recordId}`, {
      headers: { Authorization: `Bearer ${token}` } });
    await recordsResponse(response, 200);
    const data = (await json(response)).data;
    if (data?.id !== recordId || data?.payload?.attachmentId !== fileId) {
      throw new Error('record data mismatch');
    }
    return `HTTP ${response.status} id=${mask(recordId)}`;
  });
  await step('service-only kind denied', async () => {
    if (!token) blocked('dev token unavailable');
    const response = await request('/api/v1/core/records', { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json',
        'Idempotency-Key': randomUUID() }, body: JSON.stringify({ kind: 'trace_projection', payload: {
        schemaVersion: 1, originLot: { issuerInstanceId: project, lotId: memberId || randomUUID() },
        sourceEventIds: [], nodes: [], edges: [], transformVersion: 'smoke',
        asOf: new Date().toISOString(),
      } }) });
    if (response.status === 401) await recordsResponse(response, 403);
    if (![403, 422].includes(response.status)) throw new Error(`HTTP ${response.status}, expected 403/422`);
    return `HTTP ${response.status}`;
  });

  console.log('\nStep\tResult\tDetail');
  for (const { name, state, detail } of results) console.log(`${name}\t${state}\t${detail}`);
  process.exitCode = results.some(r => r.state === 'FAIL') ? 1 : results.some(r => r.state === 'BLOCKED') ? 2 : 0;
}
