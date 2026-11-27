# P11/P12 remediation check — 2026-11-28

This record supplements [G11](G11.md) and [G12](G12.md); it is **not** a gate signature.

## Phase 11 runtime checks

- A, B and C: `live-h-smoke.mjs`, `live-pdi-smoke.mjs`, `live-cross-module-smoke.mjs` each PASS against real local gateways and Keycloak.
- B/C: authenticated Staff GET `/api/v1/me`, receipts, issues, inventory balances, lot history and both trace directions returned HTTP 200. B/C gateway routes were regenerated from the current template so DX-Lab responded through `:19081`/`:19082`.
- A: the original 13 running services were started again; DX-Lab health returned HTTP 200. B/C were stopped after their checks to respect host RAM. No instance database was migrated or reset.
- `npm run test:e2e:abc` contract/topology mode PASS. This does **not** run the physical A→B→C transaction or B/C browser acceptance journey.

## Phase 12 source checks

- Archive exporter now queries after the durable checkpoint, retains event order across contiguous partitions and uses a repeatable object key. Behavior tests cover 1,001 delivered events and a failed partition write followed by retry.
- Archive query now reads private JSONL inside the worker runtime, verifies manifest and object SHA-256, and filters event IDs by batch/time/issuer without returning raw payload. Corruption detection has a unit test. Full repair/rebuild after corruption is still open.
- OT simulator now uses OIDC and `POST /api/v1/ot/readings` via the gateway. The API checks operator role, instance-bound device allowlist, local batch, body size, timestamp, value and duplicate reading ID. The lot query filters by batch in PostgreSQL before limiting results.
- `npm run test:phase12:unit` PASS (13 behavior/unit tests plus 6 static security checks); `npm run test:gateway` and `npm run typecheck` PASS. Source checks do not prove the new ERP/worker image is running.

## Remaining gate work

1. **G11:** record Admin/Approver/Receiver actions, real A→B→C exchange, AI provider and no-provider journeys, mobile HTTPS QR scan/privacy snapshot, and screen-reader/keyboard checks from [manual rehearsal](G11-manual-rehearsal.md). Automated HTTP smoke is supporting evidence only.
2. **G12 live:** build/deploy a coherent ERP+worker image and apply the 32nd Prisma migration on a controlled test instance, then exercise archive export/query, OT ingestion, quality operations, security and failure/restore paths. The demo A runtime checked here still used Phase 11 images and 31 applied migrations.
3. **P12-T02:** demonstrate worker restart, late/duplicate events, checksum corruption and a controlled rebuild from the source outbox. The new query detects corruption but does not repair it.
4. **P12-T06/T08:** GitOps controller drift/reconcile requires a separate test host or a documented BTC-approved alternative. End-to-end restore into a fresh isolated project still needs an operator run. Do not mark either as PASS from Compose or post-restore asserts alone.

No gate owner/reviewer sign-off was recorded in this check.
