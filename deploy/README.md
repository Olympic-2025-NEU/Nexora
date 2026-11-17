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
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a up -d
```

Repeat with `b` / `c` (different project name, ports, credentials, volumes).

## Profiles

- default: infrastructure (PG, Redis, Keycloak, gateway, SeaweedFS, Flowable, ClamAV)
- `local-admin`: loopback publish for Postgres + Keycloak only
- `apps`: ERP + worker + core-data (needs Dockerfiles — P01-T02)
- `dxlab`: DX-Lab frontend (P11)
- `ai`: optional AI stub

## Image pins

Digests are locked in `compose.yml` from ADR / Hub (2026-11-17): Postgres 17.6, APISIX 3.20.0-debian, Keycloak 26.8.2, SeaweedFS 4.53, Flowable REST 8.0.0, Redis 7.4-alpine, ClamAV 1.4.

## Honesty

- Realm template uses `CHANGE_ME_*` secrets — not production credentials.
- Gateway route `/gateway/ping` only; full OIDC matrix is P02.
- Prisma Migrate + fine-grained DB roles are P01-T03.
- Bucket bootstrap / realm harden / Flowable deploy scripts are P01-T04.
