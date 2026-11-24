# P04-T05 PLAN — Flowable OSS REST/BPMN bền vững (council-approved draft for owner review)

Branch: `phase04/p04-t05-flowable` off `phase-04` (8373d81). Merge law applies after verification.
Code comments: MINIMAL or none (owner rule 2026-11-20). SPDX 1-line headers stay (CI).

## Ground truth that overrides advisor guesses (chairman reconciliation)

- **ADR 0006 / D06 already pins the engine**: image `flowable/flowable-rest:8.0.0@sha256:708dfa32f27b93180bb6e7a30684d881d995fe257f5b8413e14b20a55c25672d`, PostgreSQL 17, Apache-2.0. A P00 spike already proved deploy/approve/reject/restart on this exact image (`documents/phase-plan/evidence/spikes/infra/` — compose.yaml, BPMN, smoke.py, README). The Executor's 7.2.0 pin is REJECTED; the Contrarian's "decide by testing actual calls" is already satisfied by spike evidence. Env names come from the proven spike: `SPRING_DATASOURCE_URL/USERNAME/PASSWORD`, `FLOWABLE_REST_APP_ADMIN_USER_ID`, `FLOWABLE_REST_APP_ADMIN_PASSWORD`, `FLOWABLE_REST_APP_CREATE_DEMO_DEFINITIONS=false`, `SERVER_PORT`. OpenCode MUST read the spike README/smoke.py first and reuse its proven base path/endpoints.
- **workflow-spec-v1.md already freezes the contract** (advisors B and C invented conflicting names — both rejected):
  - Process key: `goods-issue-approval` (kebab-case, same as spike BPMN id).
  - Candidate group: literal `approver`.
  - Start variables: `approvalRequestId`, `documentId`, `creatorSub`, `warehouseIds`, `submittedAt`, `submittedDocumentVersion`, `lineSnapshotSha256`. businessKey = approvalRequestId (UUID).
  - Complete variables: `decision` = `'approved' | 'rejected'`, `decisionReason`, `approverSub`, `decidedAt`. Reject REQUIRES a non-blank reason; approve reason optional. (No `approved` boolean, no `reason` variable.)
  - No tokens/PII/full documents in Flowable variables.

## Council verdict summary

- Agrees: Executor's 7-commit spine is the plan; pin by version+digest; dedicated DB + least-privilege role via bootstrap; credentials only from per-instance env through deploy/config.mjs (fail-fast, zero defaults); Flowable off APISIX; thin typed client, zero new npm deps (Node global fetch → no npm license-inventory refresh); behavior tests, not screenshots.
- Contrarian safeguards ADOPTED: boot assertions (authenticated engine call with the configured admin; default `admin/test` login must FAIL; `ACT_*` tables physically in the `flowable` database — proves no silent H2 fallback); deployment idempotency (deploy only when absent, or with an explicit force flag for the upgrade test; fixed deployment name `nexora-goods-issue-approval`; tests assert exact definition versions); reason stored as a PROCESS variable (spec already does this); restart test proves state in PostgreSQL, polling authenticated health, never fixed sleeps.
- Unanimous peer-review catch ADOPTED: Flowable POSTs are not idempotent and businessKey is NOT unique at the engine. Client contract: NO automatic retries of start/complete POSTs inside the client; network/timeout failures after a POST map to a typed `FlowableUnknownOutcomeError`; reconciliation verbs ship now (`findInstanceByBusinessKey`, task/history queries) — exactly the query-before-retry contract workflow-spec §2/§4 makes T06 implement. T05 documents this in evidence; the duplicate-start prevention itself is T06's worker design (local unique + lease), NOT T05 scope.
- Expansionist items: history exposure in the client ADOPTED (cheap, feeds G04 evidence + T07). Correlation variable REJECTED (spec freezes the start-variable set). BPMN service-task/timer demo flourishes REJECTED (T06 scope creep — 5/5 reviewers). Diagram PNG: deferred, not in T05 (can be harvested at G04 from the running engine without code).
- Outsider items: identity honesty ADOPTED as documentation — in T05, `approver` is a Flowable-side string contract; NO Keycloak sync exists or is claimed (that is T06/app territory). ADR for choosing Flowable already exists (0006/D06) — no new ADR. Backup-drill gap FLAGGED: P03's backup/restore drill does not cover the Flowable database; record in T05 evidence as a known gap for G04/P12, do NOT expand the drill inside T05.

## Design

### Topology & config
- New compose service `flowable` in the infra set (same tier as keycloak): pinned image+digest above; `depends_on` the instance PostgreSQL (healthy); NO APISIX route; host port bound to **127.0.0.1 only** (spike pattern) so bootstrap scripts and host-run test suites can reach it; engine otherwise compose-network only.
- Dedicated database `flowable` + dedicated role with rights on that database only, provisioned by the SAME bootstrap mechanism the repo already uses for secondary service databases (mirror how Keycloak's database is provisioned — inspect and follow that pattern, do not invent a parallel one).
- deploy/config.mjs gains typed, fail-fast keys (no defaults anywhere): Flowable DB password, REST admin user id, REST admin password, host port. Instance env templates updated; the existing port-distinctness/consistency validation must include the new port.
- Flowable app env (from spike): SPRING_DATASOURCE_URL pointing at the instance Postgres + `flowable` database; SPRING_DATASOURCE_USERNAME/PASSWORD = the dedicated role; FLOWABLE_REST_APP_ADMIN_USER_ID/PASSWORD from instance env; FLOWABLE_REST_APP_CREATE_DEMO_DEFINITIONS=false; database schema update enabled so Flowable creates its ACT_* tables in its own database.
- First-boot note (documented in evidence): IDM admin is seeded at first boot of a fresh Flowable database from these env values; because credentials come only from per-instance env, no default credential ever exists in this topology. Rotating them later requires a Flowable DB reset — stated plainly, not hidden.

### BPMN — deploy/flowable/processes/goods-issue-approval.bpmn20.xml
Production version of the spike file, corrected to the spec contract: process id `goods-issue-approval`; start → userTask `approveGoodsIssue` (name "Approve goods issue") with `flowable:candidateGroups="approver"` → exclusiveGateway with condition `${decision == 'approved'}` to `approvedEnd`; default flow to `rejectedEnd`. Nothing else (no service tasks, no timers — T06/P07 territory).

### Deployment — deploy/scripts/deploy-flowable.sh, wired into bootstrap
1. Wait for Flowable with AUTHENTICATED polling (configured admin credentials; a bare 401 does not count as ready).
2. Assert default credentials are dead: login attempt as `admin`/`test` must fail.
3. Query process definitions for key `goods-issue-approval` (latest): if one exists and no force flag → done (idempotent). If none (or `--force`) → POST the repo BPMN as a deployment named `nexora-goods-issue-approval`; assert the definition is queryable afterwards and print its version.
4. Assert ACT_* tables exist in the `flowable` database (via psql against the instance Postgres) — the no-H2 proof, repeated in the integration suite.

### Client — platform/workflow/flowable-client.ts
The ONLY place Flowable REST paths exist. Basic auth with the configured service admin; base URL from env (default in-network `http://flowable:8080` + spike-proven base path). Zero new dependencies (global fetch). Methods:
- `startProcess({ businessKey, variables })` → instance summary
- `findInstanceByBusinessKey(businessKey)` → instance | null (runtime), plus history fallback used by T06 reconciliation
- `getInstance(processInstanceId)`
- `queryTasks({ candidateGroup?, assignee?, processInstanceId? })`
- `completeTask(taskId, { decision, decisionReason?, approverSub, decidedAt })` — client-side validation: decision ∈ {approved, rejected}; rejected ⇒ decisionReason non-blank (mirrors spec; throws before any HTTP call)
- `cancelProcess(processInstanceId, deleteReason)`
- `getHistory(processInstanceId)` → historic instance incl. variables/end state
- `latestDefinition()` → definition for key `goods-issue-approval`
Typed errors: `FlowableHttpError` (carries status), `FlowableUnknownOutcomeError` (POST network/timeout failure — outcome unknown, reconcile by query). No internal POST retries. A `PROCESS_KEY` constant = `goods-issue-approval`. Unit tests with mocked fetch join `npm test` (request shapes, auth header, error mapping, reject-reason validation).

### Integration suite — tests/platform/run-workflow.sh + workflow.integration.test.ts, npm script `test:platform:workflow`
Follows the outbox/events harness pattern. Deterministic: unique businessKey per case; polling with timeouts, no fixed sleeps. Cases:
1. Boot assertions: authenticated engine info OK; `admin/test` rejected; ACT_* tables in the `flowable` DB.
2. Start with fixture spec variables → instance running; `queryTasks({candidateGroup: 'approver'})` finds `approveGoodsIssue`.
3. Complete `decision='approved'` (+approverSub/decidedAt) → instance ended; history shows approved end + decision variables.
4. Start → complete `decision='rejected'` with reason → rejected end; history records decisionReason. (Client blank-reason rejection is covered by unit tests.)
5. Start → cancelProcess(deleteReason) → absent from runtime; present in history with the delete reason.
6. Version upgrade: leave a v1 instance's task open; deploy the v2 fixture (same process id, task name changed) via deploy script `--force` → latest definition version = 2; a new start runs v2; the open v1 instance still completes normally on v1.
7. Restart durability: start instance; restart ONLY the flowable container; poll authenticated health; task still queryable; complete it.
Plus: extend the instance smoke script with a light check that the process definition is deployed (query via loopback) — full lifecycle stays in this suite.

## Commits (logical, in order)
1. `config(p04-t05): Flowable keys in deploy config + dedicated database/role provisioning`
2. `deploy(p04-t05): flowable compose service pinned by digest, loopback-only`
3. `feat(p04-t05): goods-issue-approval BPMN per workflow-spec contract`
4. `deploy(p04-t05): idempotent Flowable deploy script with boot assertions in bootstrap`
5. `feat(p04-t05): typed flowable-client with unknown-outcome error contract`
6. `test(p04-t05): workflow integration suite (lifecycle, upgrade, restart) + smoke definition check`
7. `docs(p04-t05): evidence and phase checkboxes` (evidence notes: image/license Apache-2.0 provenance mirroring how Keycloak's was recorded; identity honesty — group is a string contract, no Keycloak sync in T05; backup-drill gap flagged for G04/P12; first-boot credential note; T06 reconciliation contract pointer)

## Verification (Milo, independent)
- `npm test` exit 0; `npm run typecheck` exit 0.
- `npm run test:platform:workflow` all cases pass on a real stack.
- Clean-clone bootstrap brings Flowable up; deploy script idempotent on re-run (definition version stays 1); smoke passes.
- Then merge --no-ff into phase-04, push both branches, keep task branch, watch CI.

## Explicitly out of scope
App↔Flowable bridge, approval_request table, outbox workflow events, poller/reconciler (T06). Observability/admin retry (T07). DMN, Flowable UI app, multi-tenancy, Keycloak↔Flowable identity sync, BPMN timers/service tasks, backup-drill extension.
