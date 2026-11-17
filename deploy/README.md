# Deploy — Compose topology (P01-T01)

Sole Compose entrypoint: **`deploy/compose.yml`**. The legacy `deploy/docker-compose.yml` was removed.

## What this phase delivers

| Item | State after P01-T01 |
| --- | --- |
| Networks `edge` + `internal`, volumes per Compose project | Yes |
| Infra: postgres, gateway (APISIX), keycloak, flowable, seaweedfs, redis, clamav | Declared with pinned digests |
| Host ports | **Only** gateway on `127.0.0.1:${GATEWAY_HOST_PORT}` |
| App images erp / core-data / worker / dx-lab | Profile `apps` — images land in **P01-T02** |
| AI service | Profile `ai` — runtime owned by later AI phase |
| Realm / real routes / buckets / BPMN | **P01-T04** |
| DB roles + Prisma MVP migrate | **P01-T03** |
| live/ready + smoke | **P01-T06** |
| Clean-clone G01 | **P01-T07** |

`docker compose … config` passing is **not** proof that the stack boots or that AC/G01 are met.

## Image pins (P01-T01)

| Service | Image |
| --- | --- |
| gateway | `apache/apisix:3.20.0-debian@sha256:013de62a9dfba7d8e6006b3e85b524c28c9f1c3549fca3b91d5b258b0b9e759a` |
| postgres | `postgres:17.6@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929` (D03 spike pin) |
| keycloak | `quay.io/keycloak/keycloak:26.8.2@sha256:c68e286cacd87b942ac1939a0a1481461109d6acd3a57dc496969a319a76bbf0` |
| flowable | `flowable/flowable-rest:8.0.0@sha256:708dfa32f27b93180bb6e7a30684d881d995fe257f5b8413e14b20a55c25672d` |
| seaweedfs | `chrislusf/seaweedfs:4.53@sha256:ccad23e18639c8b98cee17e7100b95830a06077b56d8e5b006d6dcf8ec5e94a0` |
| redis | `redis:7.4-alpine@sha256:7f7d30b7fdd09467bac58198a1f166dd69789d348d4fe859cccb20e0cf287fbe` |
| clamav | `clamav/clamav:1.4@sha256:4cc4350d3fded380caf1799e76c0d1c93f3fa40af99c0cb2862ec0c9b117718a` (`platform: linux/amd64`) |

No etcd: APISIX runs standalone YAML (D01). Stub files live under `deploy/apisix/`.

## Instances A / B / C

Use distinct Compose **project names** and env files so volumes/networks do not collide:

| Instance | Env example | Project | Gateway loopback port |
| --- | --- | --- | --- |
| A | `instances/a.env.example` | `nexora-a` | 19080 |
| B | `instances/b.env.example` | `nexora-b` | 19081 |
| C | `instances/c.env.example` | `nexora-c` | 19082 |

```bash
# Validate infra topology (default profiles)
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env.example -p nexora-a config -q

# Include reserved app + AI services (images not built yet)
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env.example -p nexora-a \
  --profile apps --profile ai config --services
```

Copy examples to gitignored `instances/{a,b,c}.env` before any real `up` that should keep local secrets.

## Optional: publish Postgres on loopback

For host-side Prisma against the container DB:

```bash
docker compose -f deploy/compose.yml -f deploy/compose.dev-db-publish.yml \
  --env-file deploy/instances/a.env.example -p nexora-a config
```

Binds `127.0.0.1:${POSTGRES_HOST_PORT}` only. Do not expose Postgres beyond the developer machine.

## Env catalog

- Shared names: [`deploy/.env.example`](./.env.example)
- Per-instance: [`deploy/instances/`](./instances/)
- App `DATABASE_URL` for Next on the host: repo-root [`.env.example`](../.env.example)

All `*_change_me` / empty partner refs are **unsafe development placeholders**.

## Networks and ports

- `edge`: gateway (and future public edge peers).
- `internal`: postgres, keycloak, flowable, seaweedfs, redis, clamav, app profile services.
- Gateway joins both networks.
- Default topology must not publish PG, Redis, Flowable, Seaweed, Keycloak, or ClamAV admin ports to the host.
- Resource caps use both Compose `mem_limit`/`cpus` and `deploy.resources.limits` for broader engine support.

### Internal DNS (Compose service names)

| Service | Hostname on `internal` | Container port | Host publish (default) |
| --- | --- | --- | --- |
| gateway | `gateway` | 9080 | `127.0.0.1:${GATEWAY_HOST_PORT}` only |
| postgres | `postgres` | 5432 | none (optional overlay → `127.0.0.1:${POSTGRES_HOST_PORT}`) |
| keycloak | `keycloak` | 8080; health mgmt 9000 | none |
| flowable | `flowable` | 8080 | none |
| seaweedfs | `seaweedfs` | 8333 (S3 mini) | none |
| redis | `redis` | 6379 | none |
| clamav | `clamav` | 3310 | none |
| erp | `erp` | (T02) | none — profile `apps` |
| core-data | `core-data` | (T02) | none — profile `apps` |
| worker | `worker` | n/a | none — profile `apps` |
| dx-lab | `dx-lab` | (T02/P11) | none — profile `apps` |
| ai | `ai` | (later) | none — profile `ai` |

APISIX stub under `deploy/apisix/` is topology-only (`routes: []`); real OIDC/public/M2M routes arrive in **P01-T04**.
