# Nexora deploy (P01)

Single Compose entrypoint: [`compose.yml`](./compose.yml).  
Legacy `docker-compose.yml` (Postgres-only) is removed; do not reintroduce a second entrypoint.

## Topology

| Service | Network | Host publish (default) |
| --- | --- | --- |
| `gateway` (APISIX) | `edge` + `internal` | `127.0.0.1:${GATEWAY_HTTP_PORT}` → 9080 |
| `postgres` | `internal` | none (use `--profile local-admin`) |
| `redis` | `internal` | none |
| `keycloak` | `internal` | none (use `--profile local-admin`) |
| `seaweedfs` | `internal` | none |
| `flowable` | `internal` | none |
| `clamav` | `internal` | none |
| `erp` / `worker` / `core-data` | `internal` | none — `--profile apps` |
| `dx-lab` | `internal` | none — `--profile dxlab` |
| `ai` | `internal` | none — `--profile ai` |

APISIX runs **standalone YAML** (no etcd), per D01.

## Instances A / B / C

From repository root with Node 22+, Docker Engine and Docker Compose v2:

```sh
bash deploy/scripts/bootstrap.sh a  # use b or c for another isolated instance
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a --profile apps up -d --build
```

PowerShell: `./deploy/scripts/bootstrap.ps1 a`, then run the same Compose `up` command. Both scripts copy only a missing instance env file, replace matching `CHANGE_ME_*` markers with the same random value in each password/URL pair, validate the complete deployment contract, then run `compose config -q`. Existing env files are never overwritten; edit local values before rerunning validation. Instance env files stay ignored by Git (mode `0600` when generated). Never run `docker compose config` without `-q`: expanded output contains credentials. The demo defaults use loopback HTTP; Internet deployments require HTTPS for `PUBLIC_BASE_URL` and reachable OIDC endpoints. `GATEWAY_HTTPS_PORT` reserves the external HTTPS port; this P01 Compose gateway still listens on loopback HTTP. Partner secret references identify external secrets for later integration; no partner credential is created by this bootstrap. Optional AI uses `AI_PROVIDER=none`; set `AI_KEY_REF` to a secret reference for another provider. Config matrix and verification: [P01-T05 evidence](../documents/phase-plan/evidence/p01-t05.md).

If Docker Engine works but `docker compose version` reports `unknown command: docker compose`, install the Compose plugin, or use this Bash-only fallback from repository root. It runs Compose v5.7.1 in the Docker CLI container, mounts the checkout at the same absolute path for build contexts and bind mounts, and works with `bootstrap.sh` and `smoke.sh` when invoked with `bash`:

```bash
docker() { command docker run --rm --security-opt label=disable -e DOCKER_HOST=unix:///var/run/docker.sock -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD:$PWD" -w "$PWD" docker:29-cli docker "$@"; }
export -f docker
bash deploy/scripts/bootstrap.sh a
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a --profile apps up -d --build
bash deploy/scripts/smoke.sh a
```

When `19080`/`19081` is already bound, edit only `PUBLIC_BASE_URL`, `GATEWAY_HTTP_PORT`, `GATEWAY_HTTPS_PORT`, `OIDC_REDIRECT_URI_ERP`, and `OIDC_REDIRECT_URI_DXLAB` in each ignored instance env file to use a free port before first `up`. Run `bash deploy/scripts/bootstrap.sh a` again to validate. For another deployment on a shared Docker host, choose distinct Compose project names (`-p g01-a`, `-p g01-b`); Compose scopes networks, volumes and container names by project. Pass the project name to bootstrap and smoke as second argument: `bash deploy/scripts/bootstrap.sh a g01-a` and `bash deploy/scripts/smoke.sh a g01-a`. Keep the same project name for every command on each stack. Do not reuse existing project names or their volumes.

## PostgreSQL baseline (P01-T03)

One PostgreSQL instance holds separate `nexora`, `keycloak`, and `flowable` databases. `db-bootstrap` provisions roles/databases on every Compose start, even with an existing volume. App and worker use `app_runtime`; core-data uses `core_data` on the app database; only `db-migrate` uses `migrator`. PostgreSQL administrator credentials stay in the bootstrap job. Set each `CHANGE_ME_*` value in the untracked instance env file; URL passwords must match their corresponding role passwords (URL-encode special characters). Do not log resolved Compose config or commit env files.

`db-migrate` runs `prisma migrate deploy` once after bootstrap. Prisma records applied versions in `public._prisma_migrations`. It is safe to repeat without dropping rows:

```sh
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a run --rm db-migrate
```

For baseline backup, use `pg_dump -Fc` for each database (`nexora`, `keycloak`, `flowable`). Keep dumps outside Git. Restore to a new database with `pg_restore --no-owner`, check migration history and rows before routing services to the restored database. Do not restore over a running database.

## Profiles

- default: infrastructure (PG, Redis, Keycloak, gateway, SeaweedFS, Flowable, ClamAV)
- `local-admin`: loopback publish for Postgres + Keycloak only
- `apps`: ERP + worker + core-data
- `dxlab`: DX-Lab frontend (P11)
- `ai`: optional AI stub

## P01-T04 runtime bootstrap

Set `OIDC_BASE_URL` to the Keycloak URL advertised to token consumers, `OIDC_ISSUER_URL` to `${OIDC_BASE_URL}/realms/nexora`, and both exact `OIDC_REDIRECT_URI_*` values for browser clients. Choose per-instance passwords and S3 access keys in the untracked env file. `KC_DEV_USER_PASSWORD` is optional; when set, bootstrap creates `KC_DEV_USERNAME` once with a temporary password that must be changed on first login. Re-running bootstrap updates client redirect settings without resetting the dev user's password.

`keycloak-bootstrap` waits for Keycloak and provisions the realm/clients via the admin REST API. APISIX then starts with `/gateway/ping`, read-only `/core/*` and `/erp/*` upstreams. Its admin API is disabled. `storage-bootstrap` writes consumer-scoped SeaweedFS S3 identities into an instance-specific Docker volume. SeaweedFS `mini -bucket` creates the private, quarantine, and public buckets only when absent; storage files and filer metadata live in `seaweed_data`. Core-data uses `S3_ACCESS_KEY` / `S3_SECRET_KEY`; scanner access to quarantine uses `S3_SCANNER_*`; `S3_ADMIN_*` stays with storage bootstrap. The SeaweedFS admin UI binds to container loopback. Flowable REST uses its dedicated PostgreSQL role and authenticated engine health check. Bootstrap jobs rerun safely with Compose `up` or explicitly:

```sh
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a run --rm keycloak-bootstrap
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a run --rm storage-bootstrap
```

The default example issuer uses Docker's internal `keycloak` hostname. Set a browser-reachable Keycloak base URL and matching issuer for browser login in a trusted deployment; public OIDC gateway routes and access policies belong to P02.

## Image pins

Digests are locked in `compose.yml` from ADR / Hub (2026-11-17): Postgres 17.6, APISIX 3.20.0-debian, Keycloak 26.8.2, SeaweedFS 4.53, Flowable REST 8.0.0, Redis 7.4-alpine, ClamAV 1.4.

P01-T04 records runtime verification in [`../documents/phase-plan/evidence/p01-t04.md`](../documents/phase-plan/evidence/p01-t04.md). BPMN deployment and application authorization belong to later phases.

## P01-T06 health, metrics and dev infrastructure seed

Start with `--profile apps` to run ERP, core-data and worker. From the repository root, run `bash deploy/scripts/smoke.sh b` for the external aggregate check (replace `b` with `a` or `c`; pass a second project-name argument for non-default `-p`). The script uses a throwaway container attached to the project's internal Docker network. It checks PostgreSQL, gateway, Keycloak discovery, ERP/core/worker readiness, authenticated Flowable and signed S3 bucket access; it never probes readiness through the gateway. On a running default-name stack, use `bash deploy/scripts/seed.sh b` to reapply **dev-only** Keycloak realm/browser clients/optional temporary dev user and object-storage credentials/buckets. Repeating it reports `changes=0`; neither script prints credentials. Both scripts require Docker Compose and a validated, ignored `deploy/instances/b.env`.

ERP and core-data expose `/api/v1/health/live`, `/api/v1/health/ready`; worker exposes `/health/live`, `/health/ready`. ERP also exposes `/api/v1/metrics`; core-data and worker expose `/metrics` on the internal network. `service_up` is 1 only when that process's dependencies respond. `worker_queue_depth NaN` explicitly means unavailable until P04 adds an outbox queue; it does not imply an empty queue. HTTP readiness returns 503 and the fixed `dependency_unavailable` reason on failure, without revealing connection details. `x-request-id` is propagated by the gateway and included in JSON health logs; gateway access logs use the validated upstream response ID as `correlationId`. Evidence: [P01-T06](../documents/phase-plan/evidence/p01-t06.md).
