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

```powershell
Copy-Item deploy/instances/a.env.example deploy/instances/a.env
# edit CHANGE_ME_* values

docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a config -q
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a up -d --build
```

Repeat with `b` / `c` (different project name, ports, credentials, volumes).

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
- `apps`: ERP + worker + core-data (needs Dockerfiles — P01-T02)
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
