# Nexora deploy (P01–P02)

Single Compose entrypoint: [`compose.yml`](./compose.yml).  
Legacy `docker-compose.yml` (Postgres-only) is removed; do not reintroduce a second entrypoint.

For the P09 A/B/C independent-instance topology, fixture bootstrap, failure
drill and guarded reset, use [abc-topology.md](./abc-topology.md). Each demo
project has its own container names, routes, issuer, credentials and volumes.

## Topology

| Service | Network | Host publish (default) |
| --- | --- | --- |
| `gateway` (APISIX) | `edge` + `internal` | `127.0.0.1:${GATEWAY_HTTP_PORT}` → 9080 |
| `postgres` | `internal` | none (use `compose.local-admin.yml`) |
| `redis` | `internal` | none |
| `keycloak` | `internal` | none (use `compose.local-admin.yml`) |
| `seaweedfs` | `internal` | none |
| `flowable` | `internal` | `127.0.0.1:${FLOWABLE_HOST_PORT}` → 8080 (authenticated REST) |
| `clamav` | `internal` | none |
| `erp` / `worker` / `core-data` | `internal` | none — `--profile apps` |
| `dx-lab` | `internal` | none — `--profile dxlab` |
| `ai` | `internal` | none — `--profile ai` |

APISIX runs **standalone YAML** (no etcd), per D01.

## Instances A / B / C

From repository root with Node 22+, Docker Engine and Docker Compose v2:

```sh
bash deploy/scripts/bootstrap.sh a  # use b or c for another isolated instance
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora --profile apps up -d --build
bash deploy/scripts/deploy-flowable.sh a nexora
```

PowerShell: `./deploy/scripts/bootstrap.ps1 a`, then run the same Compose `up` command. Both scripts copy only a missing instance env file, replace matching `CHANGE_ME_*` markers with the same random value in each password/URL pair, validate the complete deployment contract, then run `compose config -q`. Existing env files are never overwritten; edit local values before rerunning validation. Instance env files stay ignored by Git (mode `0600` when generated). Never run `docker compose config` without `-q`: expanded output contains credentials. The demo defaults use loopback HTTP; Internet deployments require HTTPS for `PUBLIC_BASE_URL` and reachable OIDC endpoints. `GATEWAY_HTTPS_PORT` reserves the external HTTPS port; this P01 Compose gateway still listens on loopback HTTP. Partner secret references identify external secrets for later integration; no partner credential is created by this bootstrap. Optional AI uses `AI_PROVIDER=none`; set `AI_KEY_REF` to a secret reference for another provider. Config matrix and verification: [P01-T05 evidence](../documents/phase-plan/evidence/p01-t05.md).

Flowable bootstrap is the `deploy-flowable.sh` call after Compose `up`: it polls authenticated engine health, rejects `admin:test`, deploys the BPMN only when absent, and confirms `ACT_*` tables in the dedicated PostgreSQL database. Repeating it keeps the definition version unchanged; `--force [bpmn-file]` explicitly deploys an upgrade. Existing ignored instance env files created before P04-T05 need `FLOWABLE_HOST_PORT` (distinct from other host ports) and `FLOWABLE_BASE_URL=http://flowable:8080/flowable-rest/service`; bootstrap never overwrites those files. On first boot against a fresh Flowable database, the REST admin identity is seeded from `FLOWABLE_ADMIN_USER/PASSWORD`. Changing those env values after first boot does not rotate the seeded identity; rotation requires a Flowable database reset and redeployment. Do not reset a database containing live process state. Run `npm run test:platform:workflow` against a fresh instance with version 1; the test deploys version 2, restarts only Flowable, and retains process history. Set `FLOWABLE_INSTANCE` and `FLOWABLE_PROJECT` for another instance/project.

If Docker Engine works but `docker compose version` reports `unknown command: docker compose`, install the Compose plugin, or use this Bash-only fallback from repository root. It runs Compose v5.7.1 in the Docker CLI container, mounts the checkout at the same absolute path for build contexts and bind mounts, and works with `bootstrap.sh` and `smoke.sh` when invoked with `bash`:

```bash
docker() { command docker run --rm --security-opt label=disable -e DOCKER_HOST=unix:///var/run/docker.sock -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD:$PWD" -w "$PWD" docker:29-cli docker "$@"; }
export -f docker
bash deploy/scripts/bootstrap.sh a
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora --profile apps up -d --build
bash deploy/scripts/smoke.sh a
```

Containers are fixed as `nexora-<service>` (e.g. `nexora-postgres`, `nexora-gateway`). Default Compose project is `nexora` (networks/volumes `nexora_*`). When `19080`/`19081` is already bound, edit only `PUBLIC_BASE_URL`, `GATEWAY_HTTP_PORT`, `GATEWAY_HTTPS_PORT`, `OIDC_REDIRECT_URI_ERP`, and `OIDC_REDIRECT_URI_DXLAB` in each ignored instance env file to use a free port before first `up`. Run `bash deploy/scripts/bootstrap.sh a` again to validate. Because `container_name` is fixed, only one Nexora stack can run per Docker host; switch A/B/C via instance env file, not parallel `-p` projects with the same compose file. For an isolated second checkout on the same host, override project **and** remove/adjust `container_name` in a local overlay, or use a separate Docker context.

## PostgreSQL baseline (P01-T03)

One PostgreSQL instance holds separate `nexora`, `keycloak`, and `flowable` databases. `db-bootstrap` provisions roles/databases on every Compose start, even with an existing volume. App and worker use `app_runtime`; core-data uses `core_data` on the app database; only `db-migrate` uses `migrator`. PostgreSQL administrator credentials stay in the bootstrap job. Set each `CHANGE_ME_*` value in the untracked instance env file; URL passwords must match their corresponding role passwords (URL-encode special characters). Do not log resolved Compose config or commit env files.

`db-migrate` runs `prisma migrate deploy` once after bootstrap. Prisma records applied versions in `public._prisma_migrations`. It is safe to repeat without dropping rows:

```sh
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora run --rm db-migrate
```

For the three-database and object-storage backup, verification, isolated restore and retention procedure, see [backup-restore.md](./backup-restore.md). Keep backup payload outside Git; never restore over a running source project.

## Profiles

- default: infrastructure (PG, Redis, Keycloak, gateway, SeaweedFS, Flowable, ClamAV)
- `apps`: ERP + worker + core-data + file-reconciler
- `dxlab`: DX-Lab frontend (P11)
- `ai`: optional AI stub
- Host loopback publish for Postgres + Keycloak: overlay `compose.local-admin.yml` (used by `dev-up`)

## ERP UI shell (≤P06)

Public pages: `/` (home), `/login`, `/logout`, `/reset-password`. Admin surfaces stay under `/admin/*` behind the AppShell (role-filtered nav from `GET /api/v1/me`). Gateway exposes them via `/erp/*` (strip prefix) and dedicated root routes for `/`, `/login`, `/logout`, `/reset-password`, `/admin*`, `/assets/*`, `/_next/*`.

**Local login (Compose demo):** when `ALLOW_DEV_PASSWORD_LOGIN=true` on ERP, the browser posts to `/auth/dev-token` (password or refresh grant). This is not production PKCE; browser authorization-code + PKCE remains a follow-up once the issuer is browser-reachable.

**Reset password:** `/reset-password` links to Keycloak Account Console. Set optional `OIDC_ACCOUNT_URL`, or rely on `KEYCLOAK_HOST_PORT` (default link `http://127.0.0.1:${KEYCLOAK_HOST_PORT}/realms/nexora/account/`). Publish Keycloak via `compose.local-admin.yml` (or `dev-up`) so the browser can open that URL.

## Faster local iteration

Building `--profile apps` is slow because it runs `npm ci` and `next build` inside images (ERP + core-data). Prefer:

1. **Day-to-day coding:** infra in Docker + app on the host (no apps image build):
   ```powershell
   ./deploy/scripts/dev-up.ps1 a
   # then set DATABASE_URL to 127.0.0.1:$POSTGRES_HOST_PORT and:
   npm run db:migrate
   npm run dev
   ```
   Bash: `bash deploy/scripts/dev-up.sh a`. Script starts Compose with `compose.local-admin.yml` (Postgres + Keycloak on loopback) and prints the host URL hint.
2. **After the first successful image build:** omit `--build` unless `package-lock.json` / Dockerfile / Prisma schema changed:
   ```sh
   docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora --profile apps up -d
   ```
3. Rebuild images only when needed: `docker compose ... --profile apps build`. Dockerfiles use BuildKit npm/apt caches to speed repeat builds (Docker Desktop BuildKit on by default).
4. First boot of ClamAV is slow (signature download); later starts reuse `nexora_clamav_data`.
5. Optional overlay `compose.dev-db-publish.yml` publishes Postgres only; prefer `compose.local-admin.yml` for day-to-day host Next.js.

## P01-T04 runtime bootstrap

Set `OIDC_BASE_URL` to the Keycloak URL advertised to token consumers, `OIDC_ISSUER_URL` to `${OIDC_BASE_URL}/realms/nexora`, and both exact `OIDC_REDIRECT_URI_*` values for browser clients. Choose per-instance passwords and S3 access keys in the untracked env file. `KC_DEV_USER_PASSWORD` is optional; when set, bootstrap creates `KC_DEV_USERNAME` once with a temporary password that must be changed on first login. Re-running bootstrap updates client redirect settings without resetting the dev user's password.

`keycloak-bootstrap` waits for Keycloak and provisions the realm/clients via the admin REST API. APISIX then starts with `/gateway/ping`, protected `/api/v1/core/*` and `/api/v1/files*` to Core Data, and ERP routes. Its admin API is disabled. `storage-bootstrap` writes consumer-scoped SeaweedFS S3 identities into an instance-specific Docker volume. SeaweedFS `mini -bucket` creates the private, quarantine, and public buckets only when absent; storage files and filer metadata live in `seaweed_data`. Core-data uses `S3_ACCESS_KEY` / `S3_SECRET_KEY`; scanner access to quarantine uses `S3_SCANNER_*`; `S3_ADMIN_*` stays with storage bootstrap. Core Data verifies the Bearer token and membership again; gateway does not forward `X-Userinfo`. The SeaweedFS admin UI binds to container loopback. Flowable REST uses its dedicated PostgreSQL role and authenticated engine health check. Bootstrap jobs rerun safely with Compose `up` or explicitly:

```sh
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora run --rm keycloak-bootstrap
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora run --rm storage-bootstrap
```

The default example issuer uses Docker's internal `keycloak` hostname. Set a browser-reachable Keycloak base URL and matching issuer for browser login in a trusted deployment; public OIDC gateway routes and access policies belong to P02.

From P03-T05, `POST /api/v1/files` accepts a private, unlinked quarantine upload and `GET /api/v1/files/{id}` returns authorized metadata. `file-scanner` sends quarantine bytes to ClamAV, checks the stored checksum, records the scanner and signature version, and moves only clean files to private storage. `?download=1` requires a clean private object and checks the checksum again. Scanner downtime and timeout keep files unavailable and schedule bounded retries. Administrators can retry an error with `POST /api/v1/files/{id}/retry-scan` or discard infected quarantine bytes with `POST /api/v1/files/{id}/discard`; both actions retain audit evidence. `file-reconciler` removes stale unreferenced quarantine and private copies and marks missing pending objects as error. See [file-storage.md](../documents/phase-plan/file-storage.md) for policy and failure recovery.

When upgrading an existing instance to T05, apply the new Prisma migration, rerun `storage-bootstrap` for the scanner's private write grant, and restart SeaweedFS and app services in a maintenance window so the new policy loads. Keep the `clamav_data` volume; the ClamAV image starts `freshclam` automatically. Inspect `docker compose ... logs clamav` for a current successful signature update and check `file-scanner` logs for scan errors before accepting demo uploads. `npm run test:platform:scan` uses isolated containers and a safe EICAR test pattern assembled at runtime.

## P02-T07 — Realm/Client Provisioning, HTTPS, Rotate/Revoke

### Keycloak realm setup

The bootstrap script (`deploy/keycloak/bootstrap.mjs`) provisions the `nexora` realm with:

- ERP browser client (`erp-browser`) — public, auth-code+PKCE, redirect to `OIDC_REDIRECT_URI_ERP`
- DX-Lab browser client (`dxlab-browser`) — public, auth-code+PKCE
- Gateway OIDC client (`gateway-oidc`) — confidential, used by APISIX OIDC plugin for token introspection
- Partner inbound client (`partner-inbound-a`) — service accounts enabled, scope `federation:write`

**After bootstrap:**

1. Set `OIDC_GATEWAY_CLIENT_ID=gateway-oidc` and `OIDC_GATEWAY_CLIENT_SECRET=<secret>` in your instance env.
2. Add these to the APISIX routes.yaml substitution (or set literal value in the YAML).
3. For MFA: Keycloak → Realm → Authentication → Required Actions → enable `CONFIGURE_TOTP` for administrator/approver users.

### Create a partner receiver client (B for A)

```
1. Log in to Keycloak admin for Instance B
2. Create client: "partner-inbound-a"
   - Client type: OpenID Connect
   - Service accounts enabled: ON
   - Standard flow: OFF
3. Add scope "federation:write" to client scopes
4. Copy client secret
5. In Instance A DB:
   INSERT INTO system.partner_connection (inbound_client_id, ...) VALUES ('partner-inbound-a', ...)
6. Test:
   curl -X POST https://<b-host>/realms/nexora/protocol/openid-connect/token \
     -d "grant_type=client_credentials&client_id=partner-inbound-a&client_secret=<secret>&scope=federation:write"
   # → access_token
   curl -X POST https://<a-gateway>/api/v1/federation/events \
     -H "Authorization: Bearer <access_token>" \
     -H "Content-Type: application/json" -d '{...}'
   # → 202
```

### Rotate partner credentials

```
1. In Keycloak: regenerate client secret for partner-inbound-a
2. In DB: UPDATE system.partner_connection SET status='rotating', rotated_at=now() WHERE inbound_client_id='partner-inbound-a'
3. Update secret in secret store (do NOT put in DB)
4. Notify partner of new secret
5. After partner confirms: UPDATE ... SET status='active'
```

### Revoke partner access immediately

```sql
UPDATE system.partner_connection SET status='disabled' WHERE inbound_client_id='partner-inbound-a';
-- Next request from that partner → 403 PARTNER_CONNECTION_INACTIVE
-- No token blacklist needed — DB row is checked on every request
```

Also disable the Keycloak client to prevent new token issuance.

### HTTPS local setup (mkcert)

```powershell
# Windows
.\deploy\scripts\gen-local-certs.ps1
```

```bash
# Linux / macOS
./deploy/scripts/gen-local-certs.sh
```

Generates `deploy/certs/local.pem` and `local-key.pem` (gitignored).  
Set `PUBLIC_BASE_URL=https://localhost:19443` (prefer `localhost` over `127.0.0.1` for mkcert clients) and matching `OIDC_REDIRECT_URI_*`, then re-render routes and recreate the gateway:

```powershell
node deploy/scripts/render-apisix-routes.mjs deploy/instances/a.env
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora up -d --force-recreate gateway
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora run --rm keycloak-bootstrap
$env:NODE_EXTRA_CA_CERTS = "$(mkcert -CAROOT)\rootCA.pem"
node deploy/scripts/smoke-https-local.mjs a
```

For Node.js to trust the local CA:

```bash
export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
```

**HTTP fallback (no certs):** Set `PUBLIC_BASE_URL=http://127.0.0.1:19080`. The gateway HTTP port still works for local smoke when certs are absent. OIDC issuer must use the same scheme; for HTTP smoke, set `OIDC_ISSUER_URL=http://keycloak:8080/realms/nexora`.

### 401/403 error codes reference

| Code | Status | Meaning |
|---|---|---|
| `MISSING_BEARER` | 401 | Authorization header absent or not `Bearer` prefix |
| `INVALID_TOKEN` | 401 | Token expired, wrong issuer/audience, invalid signature |
| `MEMBERSHIP_NOT_FOUND` | 403 | `sub` not in `system.membership` |
| `MEMBERSHIP_INACTIVE` | 403 | Membership status is not `active` |
| `POLICY_DENIED` | 403 | Insufficient role for requested action |
| `PARTNER_NOT_FOUND` | 403 | M2M `client_id` not in `system.partner_connection` |
| `PARTNER_CONNECTION_INACTIVE` | 403 | Partner connection disabled/rotating |
| `MISSING_SCOPE` | 403 | M2M token missing `federation:write` scope |
| `FORGED_IDENTITY_HEADER` | 403 | Client sent `X-Userinfo` / `X-Authenticated-User` etc. |

## Image pins

Digests are locked in `compose.yml` from ADR / Hub (2026-11-17): Postgres 17.6, APISIX 3.20.0-debian, Keycloak 26.8.2, SeaweedFS 4.53, Flowable REST 8.0.0, Redis 7.4-alpine, ClamAV 1.4.

P01-T04 records runtime verification in [`../documents/phase-plan/evidence/p01-t04.md`](../documents/phase-plan/evidence/p01-t04.md). BPMN deployment and application authorization belong to later phases.

## P01-T06 health, metrics and dev infrastructure seed

Start with `--profile apps` to run ERP, core-data and worker. From the repository root, run `bash deploy/scripts/smoke.sh b` for the external aggregate check (replace `b` with `a` or `c`; pass a second project-name argument for non-default `-p`). The script uses a throwaway container attached to the project's internal Docker network. It checks PostgreSQL, gateway, Keycloak discovery, ERP/core/worker readiness, authenticated Flowable and signed S3 bucket access; it never probes readiness through the gateway. On a running default-name stack, use `bash deploy/scripts/seed.sh b` to reapply **dev-only** Keycloak realm/browser clients/optional temporary dev user and object-storage credentials/buckets. Repeating it reports `changes=0`; neither script prints credentials. Both scripts require Docker Compose and a validated, ignored `deploy/instances/b.env`.

ERP and core-data expose `/api/v1/health/live`, `/api/v1/health/ready`; worker exposes `/health/live`, `/health/ready`. ERP also exposes `/api/v1/metrics`; core-data and worker expose `/metrics` on the internal network. `service_up` is 1 only when that process's dependencies respond. `worker_queue_depth NaN` explicitly means unavailable until P04 adds an outbox queue; it does not imply an empty queue. HTTP readiness returns 503 and the fixed `dependency_unavailable` reason on failure, without revealing connection details. `x-request-id` is propagated by the gateway and included in JSON health logs; gateway access logs use the validated upstream response ID as `correlationId`. Evidence: [P01-T06](../documents/phase-plan/evidence/p01-t06.md).
