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

## Local Phase 9 federation transport (A↔B↔C)

The optional `compose.federation-demo.yml` adds one Docker network shared by
**gateways and workers only**. Each gateway has a distinct HTTPS DNS name on
that network. PostgreSQL and Keycloak stay on their own instance's internal
network. The receiving gateway exposes only the exact Keycloak client-token
POST route needed for M2M; no Keycloak admin route is exposed. This is a local
demo topology with a mkcert CA, not a production trust or secret deployment.

Run these commands from the repository root in PowerShell. They require the
three ignored env files prepared above, `mkcert` installed, and Docker Desktop.
The federation secret preparer writes matching sender/receiver credentials to
those ignored files and can be rerun without rotating them. Keep the generated
CA private key and instance env files off Git and out of logs.

```powershell
$env:DEMO_ONLY = "true"
node deploy/scripts/prepare-abc-federation.mjs
.\deploy\scripts\gen-local-certs.ps1
docker network inspect nexora-federation *> $null
if ($LASTEXITCODE -ne 0) { docker network create nexora-federation }
foreach ($i in @("a", "b", "c")) {
  node deploy/scripts/render-apisix-routes.mjs "deploy/instances/$i.env"
  docker compose -f deploy/compose.yml -f deploy/compose.local-admin.yml -f deploy/compose.federation-demo.yml --env-file "deploy/instances/$i.env" -p "nexora-$i" --profile apps config -q
}
docker compose -f deploy/compose.yml -f deploy/compose.local-admin.yml -f deploy/compose.federation-demo.yml --env-file deploy/instances/a.env -p nexora-a --profile apps up -d --build erp gateway worker seaweedfs
docker compose -f deploy/compose.yml -f deploy/compose.local-admin.yml -f deploy/compose.federation-demo.yml --env-file deploy/instances/b.env -p nexora-b --profile apps up -d erp gateway worker seaweedfs
docker compose -f deploy/compose.yml -f deploy/compose.local-admin.yml -f deploy/compose.federation-demo.yml --env-file deploy/instances/c.env -p nexora-c --profile apps up -d erp gateway worker seaweedfs
foreach ($i in @("a", "b", "c")) { node deploy/scripts/seed-abc.mjs $i }
node deploy/scripts/configure-abc-federation.mjs
```

Before submitting the first issue, deploy the BPMN in each Flowable engine
from Git Bash (or another Bash shell with Docker CLI access):

```bash
for i in a b c; do bash deploy/scripts/deploy-flowable.sh "$i" "nexora-$i"; done
```

Keep all three `-f` files when recreating a demo worker. Omitting
`compose.federation-demo.yml` removes the shared federation network, outbound
secret slots and local CA trust; an existing transfer then retries without
reaching the receiving gateway. Deploy the Flowable BPMN on A/B/C before
submitting any GoodsIssue, or the approval request remains in `starting` and
the approver inbox stays empty. The guarded `journey-p09-core.mjs` checks all
three definitions before creating its first document.

Always rebuild the `db-migrate` image after pulling new Prisma migrations.
Check `docker compose ... logs db-migrate` for its exit code and compare the
image's migration list with `prisma/migrations/` if the ERP reports a missing
table. Re-run the migrator against each existing instance before testing a new
inbound contract. `configure-abc-federation.mjs` verifies project and database
identity, then upserts only adjacent partner connections with HTTPS endpoint,
token URL, M2M client ID, audience and `env:` secret reference. It never writes
the secret value to PostgreSQL.

To verify all four directions from the actual sending worker, copy the
disposable smoke script into the containers and run it with `DEMO_ONLY=true`.
It requests a receiver-issued token, sends a unique synthetic envelope, and
replays the same envelope to check ACK idempotency. Each test leaves one
`pending_dependency` inbox record and no stock movement.

```powershell
foreach ($i in @("a", "b", "c")) { docker cp deploy/scripts/smoke-abc-federation.mjs "nexora-$i-worker-1:/tmp/smoke-abc-federation.mjs" }
docker exec -e DEMO_ONLY=true nexora-a-worker-1 node /tmp/smoke-abc-federation.mjs a b 1
docker exec -e DEMO_ONLY=true nexora-b-worker-1 node /tmp/smoke-abc-federation.mjs b a 1
docker exec -e DEMO_ONLY=true nexora-b-worker-1 node /tmp/smoke-abc-federation.mjs b c 2
docker exec -e DEMO_ONLY=true nexora-c-worker-1 node /tmp/smoke-abc-federation.mjs c b 1
```

This checks federation transport and technical ACK. It does not complete a
business transfer, local lot mapping, or the full G09 demo journey.

## Reset a designated demo project

`abc-reset.mjs` requires `DEMO_ONLY=true`, an explicit `a|b|c` and a
matching ignored env file. It runs Compose `down -v` **only** for the named
project, removing that project's data. It refuses other project names and
does not touch production volumes. Review the chosen instance before running:

```powershell
$env:DEMO_ONLY = "true"
node deploy/scripts/abc-reset.mjs b
```
