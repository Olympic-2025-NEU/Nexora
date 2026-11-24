# P09-T01 — three independent demo instances

This local topology uses three Compose projects: `nexora-a`, `nexora-b`,
`nexora-c`. Each project owns its PostgreSQL cluster (app, Keycloak and
Flowable databases), Keycloak realm state, ERP, gateway, internal network and
named volumes. The realm name is `nexora` inside each independent Keycloak
database; distinct `keycloak-a/b/c` issuer hostnames prevent tokens from
sharing an issuer. No service connects to another project's PostgreSQL or
mounts another project's volume. Only the gateway and opt-in localhost admin
overlay publish host ports. Credentials live in ignored
`deploy/instances/{a,b,c}.env`, generated locally by `prepare.mjs`.

## Prepare and start

Run from the repository root with Docker Desktop, Node 24 and `npm ci && npm run
db:generate`. Reserve the ports in the three env examples. Generated env,
APISIX routes and fixture manifests are ignored by Git.

```powershell
$env:DEMO_ONLY = "true"
foreach ($i in @("a", "b", "c")) {
  node deploy/scripts/prepare.mjs $i
  node deploy/scripts/render-apisix-routes.mjs "deploy/instances/$i.env"
  docker compose -f deploy/compose.yml -f deploy/compose.local-admin.yml --env-file "deploy/instances/$i.env" -p "nexora-$i" --profile apps config -q
}
docker compose -f deploy/compose.yml -f deploy/compose.local-admin.yml --env-file deploy/instances/a.env -p nexora-a --profile apps up -d --build erp gateway seaweedfs
docker compose -f deploy/compose.yml -f deploy/compose.local-admin.yml --env-file deploy/instances/b.env -p nexora-b --profile apps up -d erp gateway seaweedfs
docker compose -f deploy/compose.yml -f deploy/compose.local-admin.yml --env-file deploy/instances/c.env -p nexora-c --profile apps up -d erp gateway seaweedfs
foreach ($i in @("a", "b", "c")) { node deploy/scripts/seed-abc.mjs $i }
node --test tests/e2e/abc-topology.test.mjs
node tests/e2e/abc-topology-drill.mjs
```

Use `--build` again after code or Dockerfile changes. A single local image
tag is shared for identical code, while every runtime state volume and
credential is project scoped. `deploy/scripts/seed-abc.mjs` refuses any
project other than `nexora-a|b|c`, verifies its Compose label and requires
`DEMO_ONLY=true`. It is repeatable: it creates an organization, active
administrator/staff/approver memberships, A-P1/B-P1/C-P1 products, local
batches, warehouses and adjacent partner stubs. The stock remains zero and
the batches remain `inspect`; no receipt or movement is fabricated.
The three local batch IDs differ, while the fixture origin is the same
`(nexora-a, A-L1)` UUID recorded in each ignored fixture manifest. P09-T05
will replace fixture knowledge with validated inbound lot mapping.

## Failure drill and evidence

`abc-topology-drill.mjs` checks three distinct PostgreSQL cluster system
identifiers, organization IDs, Keycloak issuers, roles, partner stubs,
zero-stock fixtures and project volumes. It stops B, creates and reads a
receipt via A and C's gateway/API, confirms it, checks B is unavailable, and checks
that A/C's PostgreSQL outbox tables remain writable and persistent. It then
restarts B and verifies its fixture remains intact. The drill records only
IDs/statuses, never credentials. It does **not** assert federation delivery:
the outbound worker, technical ACK and partner inbox belong to P09-T03/T04.
The drill leaves one unit of stock in A and C. Reset and re-seed the disposable
demo projects before running the 20→12→10→6→2 fixture journey.

For manual inspection:

```powershell
docker compose -f deploy/compose.yml --env-file deploy/instances/a.env -p nexora-a ps
docker compose -f deploy/compose.yml --env-file deploy/instances/b.env -p nexora-b ps
docker compose -f deploy/compose.yml --env-file deploy/instances/c.env -p nexora-c ps
```

HTTP and the localhost admin overlay are only for a local isolated demo.
For remote access, configure per-instance HTTPS certificates and issuer URLs
before starting a stack. Never publish PostgreSQL, Keycloak admin or Flowable
admin to an external interface.

## Reset a designated demo project

`abc-reset.mjs` requires `DEMO_ONLY=true`, an explicit `a|b|c` and a
matching ignored env file. It runs Compose `down -v` **only** for the named
project, removing that project's data. It refuses other project names and
does not touch production volumes. Review the chosen instance before running:

```powershell
$env:DEMO_ONLY = "true"
node deploy/scripts/abc-reset.mjs b
```
