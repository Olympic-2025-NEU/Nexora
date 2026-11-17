# P01-T01 — Compose topology evidence

**Date:** 2026-11-17  
**Branch:** `feature/p01-t01-compose-topology`  
**Gate for this task:** `docker compose … config` (and rendered port inspection). **Not** an `up` / `ps` / G01 claim.

`ps` and live network inspect require a bootable stack (DB roles T03, bootstrap T04, app images T02). Those checks stay open until the owning tasks can start containers cleanly.

## Commands run

```bash
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env.example -p nexora-a config -q
docker compose -f deploy/compose.yml --env-file deploy/instances/b.env.example -p nexora-b config -q
docker compose -f deploy/compose.yml --env-file deploy/instances/c.env.example -p nexora-c config -q

docker compose -f deploy/compose.yml --env-file deploy/instances/a.env.example -p nexora-a \
  --profile apps --profile ai config --services

# Port / host_ip inspection from rendered config (no up)
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env.example -p nexora-a config \
  | rg 'host_ip:|published:'
```

## Results

| Check | Result |
| --- | --- |
| `config -q` for nexora-a / b / c | Exit 0 |
| Sole entrypoint | `deploy/compose.yml`; `deploy/docker-compose.yml` removed |
| Published host port (default) | Gateway only: `host_ip: 127.0.0.1`, ports 19080 / 19081 / 19082 |
| Profile `apps` + `ai` services | erp, core-data, worker, dx-lab, ai listed (images reserved for T02) |
| Digests + licenses | APISIX/Keycloak/SeaweedFS/Flowable/Postgres/Redis/ClamAV pinned; recorded in `deploy/README.md`, D13, `license-inventory.md` |
| Hostname map | Documented in `deploy/README.md` |
| Resource limits | `mem_limit`/`cpus` + `deploy.resources.limits` on each service |
| Gateway ↔ Postgres | No false `depends_on` |
| APISIX routes stub | `routes: []` — not a production path |

## Explicitly not verified here

- Container `up`, `compose ps`, live network inspect  
- Keycloak realm, APISIX OIDC routes, Seaweed buckets, Flowable BPMN  
- Prisma role bootstrap and MVP schema  
- App/worker image build  
