# P04-T06 — PLAN: App ↔ Flowable bridge (approval request lifecycle)

Council-produced plan (5 advisors + 6 peer reviews, chairman synthesis by Milo).
Base plan: Executor (unanimously voted the spine). Mechanisms imported from
Contrarian + First Principles; honesty/evidence layer from Outsider +
Expansionist. Where a council proposal conflicted with the frozen spec
(`documents/phase-plan/workflow-spec-v1.md`), the SPEC won — each such ruling
is marked [SPEC WINS]. Branch: `phase04/p04-t06-workflow-bridge` off
`phase-04` (ae0f710). Minimal comments; SPDX headers stay.

## 0. What T06 is — and is not

T06 builds the platform bridge machinery between the application and the
Flowable engine installed in T05: a local `approval_request` record, a starter
that starts engine processes idempotently, an application-side decision path,
a dispatch worker that completes engine tasks only after re-verification, a
reconciler that projects engine history into local state, and a confirm gate.
The GoodsIssue business module does NOT exist yet (later phases), so T06 is
exercised through fixture documents and an adversarial fixture caller. HTTP
routes (`/issues/...`), the approver inbox UI, the Inventory port and stock
effects are module-phase work and are NOT in T06.

Invariants (the whole design serves these):

- I1. One approval request → at most one engine process → at most one
  dispatched decision. The durable binding is the triple
  (documentId, submittedDocumentVersion, lineSnapshotSha256) tied to exactly
  one stored `flowable_process_id`; every later engine interaction addresses
  the process by that stored ID, never by re-resolving "the process for this
  document".
- I2. No engine effect without a prior committed local intent. The Flowable
  client is injected ONLY into worker/reconciler composition — never into
  command handlers or the service API that runs inside request transactions.
- I3. Authorization is decided app-side, twice: at decision time and again at
  dispatch time, immediately before the engine call. The engine candidate
  group `approver` is a routing label, never a security boundary. The named
  authorization point is the dispatch recheck: a revocation detected there
  wins; a revocation landing after the engine call succeeds does NOT undo the
  decision (the reconciler syncs it), and the confirm gate re-checks the
  confirming actor's CURRENT permission.
- I4. Local `approved`/`rejected` are a one-way, idempotent projection of
  engine history, written by the reconciler (or the confirm path's
  reconcile-on-read) only, from history only, and only when the history
  outcome is proven to match a recorded local intent (see §5, nonce proof).
  An engine outcome with NO matching intent is never synced as a normal
  approval — it halts (EXTERNAL_COMPLETION).
- I5. Confirm consumes the approval exactly once, atomically with the
  caller's effect: a guarded CAS transition `approved → confirmed` executed
  by the bridge inside the CALLER's transaction.
- I6. Ambiguity always resolves toward waiting or halting, never toward
  granting. Dead-lettered outbox rows park the request in its current
  non-terminal state; they never release the document.

## 1. Schema — `platform.approval_request`

Migration: `prisma/migrations/20261120020000_platform_workflow_approval/migration.sql`
(timestamp prefix follows the T02/T03 pattern; adjust if the repo's migration
naming differs — verify against `prisma/migrations/` first).

```sql
CREATE TYPE platform.approval_request_state AS ENUM
  ('requested','starting','pending','decision_pending',
   'approved','rejected','confirmed','cancelled','halted');

CREATE TABLE platform.approval_request (
  id                          uuid PRIMARY KEY,              -- = Flowable businessKey
  document_id                 uuid NOT NULL UNIQUE,          -- resubmit after reject = NEW document id
  submitted_document_version  integer NOT NULL,
  creator_sub                 text NOT NULL,
  warehouse_ids               jsonb NOT NULL,                -- scope-checked as a set
  line_snapshot_sha256        char(64) NOT NULL,             -- stored verbatim; bridge never recomputes in production paths
  state                       platform.approval_request_state NOT NULL DEFAULT 'requested',
  flowable_process_id         text NULL,
  flowable_definition_id      text NULL,                     -- definition the process actually bound to
  flowable_definition_version integer NULL,
  flowable_task_id            text NULL,                     -- captured at decision-intent time
  decision_intent             text NULL CHECK (decision_intent IN ('approved','rejected')),
  decision_intent_reason      text NULL,
  decision_requested_by_sub   text NULL,
  decision_requested_at       timestamptz NULL,              -- intent time; ALSO the decidedAt nonce (see §4)
  decision                    text NULL CHECK (decision IN ('approved','rejected')),  -- synced ONLY from history
  decision_reason             text NULL,
  approver_sub                text NULL,
  decided_at                  timestamptz NULL,              -- decision variable decidedAt as proven in history
  engine_completed_at         timestamptz NULL,              -- historic process end time (authoritative for effect)
  cancel_reason               text NULL,
  engine_cleanup_at           timestamptz NULL,              -- tombstone cleanup done (see §6)
  halt_reason                 text NULL,                     -- see halt taxonomy below
  confirmed_by_sub            text NULL,
  confirmed_at                timestamptz NULL,
  version                     integer NOT NULL DEFAULT 1,    -- CAS / optimistic lock on every transition
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX approval_request_process_uq
  ON platform.approval_request (flowable_process_id) WHERE flowable_process_id IS NOT NULL;
CREATE INDEX approval_request_reconcile_ix
  ON platform.approval_request (state, updated_at);
```

Halt taxonomy (`state='halted'`, `halt_reason` one of): `DUPLICATE_PROCESS`,
`PROCESS_VANISHED`, `HISTORY_WITHOUT_DECISION`, `EXTERNAL_COMPLETION`,
`DECISION_CONFLICT`, `BINDING_MISMATCH`, `INVALID_START_VARIABLES`,
`ENGINE_REJECTED_START`. `halted` is terminal inside T06; resolution is
operator action / T07 tooling. Terminal states `approved` (until confirm),
`rejected`, `confirmed`, `cancelled`, `halted` are immutable except through
the transitions defined in §2 — enforced by CAS updates in the repository
(`WHERE id=? AND version=? AND state IN (...)`, rowcount must be 1).

Intent columns and synced-decision columns are deliberately separate: intent
is what the app asked for; `decision*` is what engine history proves. Confirm
reads only the synced columns.

## 2. State machine

```
        createRequest
  ─────────────────────▶ requested ──starter claim──▶ starting ──process bound──▶ pending
                            │                            │                        │
                            │                            │                        ├─ recordDecisionIntent ─▶ decision_pending
                            │                            │                        │        │
                            │                            │                        │        ├─ dispatch recheck fails (pre-POST) ─▶ pending (intent reset)
                            │                            │                        │        └─ reconciler syncs from history ─▶ approved | rejected
                            │                            │                        └─ reconciler syncs out-of-band outcome ─▶ approved | rejected (only with matching intent proof — impossible from pending, see §5; no-intent outcome ─▶ halted)
                            ├─ cancel (any non-terminal state) ─▶ cancelled (tombstone, §6)
                            └─ any state ──halt condition──▶ halted
  approved ──confirmApproval (CAS, caller's tx)──▶ confirmed
```

- `starting` is a real state (the spec matrix writes `requested/starting`):
  entered when the starter claims the start attempt, before the process ID is
  saved. It makes the crash window visible instead of hiding it in worker
  bookkeeping.
- `decision_pending → pending` exists ONLY for the dispatch worker's pre-POST
  recheck failure (e.g. role revoked). Once the engine call is made, that exit
  closes forever; uncertainty after the call belongs to the reconciler.
- The contract doc carries this as a hand-written Mermaid diagram plus a
  state table (entered when / left when / who moves it / what the document
  shows meanwhile).

## 3. Workers ride the T03 outbox dispatcher — plus one reconciler

Add a third destination `workflow` to `EVENT_DESTINATIONS` /
`buildHandlerMap()` in `composition/event-handlers.ts`, with two consumers.
This AMENDS T04's "destinations are fixed constants" freeze by exactly one
internal destination; the amendment is recorded in the contract doc (§9),
not slipped in. Consumers:

- `flowable-starter.ts` consumes `workflow.approval.requested.v1`
  (payload schemas for both events already exist under `contracts/events/` —
  verify and register them in `contracts/events/registry.ts`; do not invent
  new schemas).
- `flowable-decider.ts` consumes `workflow.approval.decision_requested.v1`.
  Payload: `{ approvalRequestId, decision, decidedAt, flowableTaskId,
  intentVersion }` — a delivery whose `intentVersion` no longer matches the
  row is a stale/superseded intent and no-ops successfully.

Per-aggregate ordering key = `approval_request.id` for both events, so a
decision delivery cannot be claimed before the start delivery for the same
request has completed. `recordDecisionIntent` additionally requires
`state='pending'`, which makes an early intent unreachable in practice (an
approver cannot have seen a task that does not exist yet).

The reconciler (`reconciler.ts`) is NOT a delivery mechanism: it never starts
or completes anything except tombstone cleanup (§6). It runs in the worker
process next to the dispatcher, interval 5s
(`WORKFLOW_RECONCILE_INTERVAL_MS`, code default — NO new required env key;
do not repeat the T05 a.env trap), batch 50 rows per tick, each row in its own
short transaction with CAS on `version`; failures log and continue, never
crash the loop.

Concurrency discipline (all three actors): a session-level PostgreSQL
advisory lock keyed by the approval id (`pg_try_advisory_lock(hashtext(id))`)
is held across query → POST → save (starter), ladder → POST (decider), and
finalize (reconciler). If the lock is not acquired, the actor skips this
cycle — that is not an error. The T03 lease/fencing remains liveness only;
correctness comes from the advisory lock + CAS + query-before-act.

## 4. Starter — query-before-start, write-ahead, pre-flight

On delivery of `workflow.approval.requested.v1`:

1. Load the row. If state is `cancelled` or `halted` → consume (no-op). If
   state is `pending` with a bound process id → consume (already started).
2. CAS `requested → starting` (or accept `starting` on redelivery).
3. Take the advisory lock. Re-read state under the lock: if `cancelled` →
   abort, consume (tombstone wins, §6).
4. Pre-flight validation of the start variables against workflow-spec-v1:
   UUID shapes, `line_snapshot_sha256` matches `^[0-9a-f]{64}$`,
   `warehouse_ids` non-empty array, `submitted_document_version` positive,
   creator sub non-empty. Failure = PERMANENT: throw the T04
   `PermanentDeliveryError` pattern (dead-letter on attempt 1, typed code
   `INVALID_START_VARIABLES`) and CAS the row → `halted` with that reason.
5. Query runtime AND history by businessKey:
   - exactly 1 instance → verify binding (definition key ==
     `goods-issue-approval`; start variables `approvalRequestId` == row id,
     `documentId` == row document_id). Match → adopt: save
     `flowable_process_id`, `flowable_definition_id`,
     `flowable_definition_version`, CAS → `pending`, consume. Mismatch →
     `halted` (`BINDING_MISMATCH`), consume.
   - more than 1 → `halted` (`DUPLICATE_PROCESS`), audit + structured log,
     consume. Never silently pick one.
   - 0 → POST start with the spec's start variables (approvalRequestId,
     documentId, creatorSub, warehouseIds, submittedAt,
     submittedDocumentVersion, lineSnapshotSha256), businessKey = row id.
     Binding semantics [contract]: the request binds to the LATEST deployed
     definition version at start time; the bound definition id/version are
     recorded on the row. On success save the process id + definition
     id/version, CAS → `pending`.
6. Error taxonomy on the POST: engine 400 → permanent (record the engine
   message; row → `halted` `ENGINE_REJECTED_START`) — EXCEPT "process
   definition not found", which is a TRANSIENT environmental error (fresh
   stack, worker up before the deploy step) and follows normal retry.
   429/5xx/timeout/`FlowableUnknownOutcomeError` → transient: throw, the
   dispatcher retries; the next delivery re-enters at step 5 and queries
   first — never a blind second POST.

## 5. Decision path — intent, ladder, nonce proof

### 5.1 `recordDecisionIntent` (service API, caller's transaction)

Validates IN ORDER: actor active; `actor.sub != creator_sub`
(SelfApprovalError → 403); request `warehouse_ids` ⊆ actor's warehouse ids
(ApprovalScopeError → 403); `state == 'pending'`; row `version` matches the
caller's expected version (else VersionConflictError → 409); `decision =
'rejected'` ⇒ nonblank reason (validation → 422). On success, in the same
transaction: write intent fields + `flowable_task_id` (the task the approver
acted on, from the task-inbox read) + `decision_requested_at = now()`, CAS →
`decision_pending`, audit, emit `workflow.approval.decision_requested.v1`.

Replay semantics (the decision call is itself idempotent): if the row is
already `decision_pending` AND the stored intent matches the call (same actor
sub, same decision, same task id) → return the existing row as success, no
new outbox row. If an intent exists and differs → DecisionConflictError
(409). Contract mapping for the future HTTP layer: same Idempotency-Key +
same payload → replay the original 202; same key + different payload → T02
`IDEMPOTENCY_CONFLICT` at the pipeline; a genuinely different decision while
one is pending → 409.

The `decidedAt` completion variable is generated ONCE, here, from
`decision_requested_at`, stored on the row, and reused verbatim on every
dispatch retry. It is the correlation nonce that proves a later history entry
is OUR completion: match `decision` + `approverSub` + `decidedAt`.

### 5.2 Decider — verification ladder before any POST

On delivery of `workflow.approval.decision_requested.v1`, take the advisory
lock, then run the ladder IN ORDER; every failure has its named branch; NO
fallback task resolution ever (never re-resolve a task by document or
businessKey):

1. Row state == `decision_pending`, intent fields present, payload
   `intentVersion` == row version. (State `cancelled` → consume silently.
   Stale version → consume as superseded.)
2. Intent snapshot == row snapshot (`line_snapshot_sha256` unchanged since
   intent). [Scope note: the bridge cannot recompute a hash from real lines —
   no module exists. Content integrity is enforced by the confirm gate (§7)
   against the caller-supplied current hash, and by the module's
   lines-immutable-after-submit rule. The dispatch recheck covers actor
   validity + binding + intent currency.]
3. Process: `getInstance(flowable_process_id)` exists; businessKey == row
   id; process definition id == recorded `flowable_definition_id`.
4. Task: exact-id lookup of `flowable_task_id`; task exists,
   `task.processInstanceId` == stored process id, `taskDefinitionKey` ==
   `approveGoodsIssue`.
5. History: no end state already recorded for this process.
6. Actor recheck via the resolver (CURRENT data): active, approver role,
   warehouse scope superset, sub != creator. Failure → reset intent (intent
   fields NULL, CAS → `pending`, audit with the revocation reason), consume.
   The engine task is left open.

Only then: `completeTask` with variables `decision`, `decisionReason`
(reject ⇒ the recorded reason), `approverSub` = intent actor,
`decidedAt` = the stored nonce.

Lost-response handling (query before any retry, on redelivery): task gone →
read history. History shows completion with variables matching the nonce
proof → consume as success (the reconciler syncs the state; the decider
never writes `approved`/`rejected` itself). History shows a completion with
DIFFERENT variables → `halted` (`DECISION_CONFLICT`) + audit, consume. Task
gone + no history yet → transient throw (history can lag; absence of history
is not evidence of cancellation). Task still open → complete it (the earlier
attempt provably did not land).

Engine down during dispatch: transient errors follow dispatcher
backoff/retry; the approval stays `decision_pending`; nothing is confirmed
or changed locally. If the delivery eventually dead-letters (8 attempts,
long outage), the decision is NOT lost and NOT auto-applied: revival is
T03's `retryDeadLetter()` via T07's admin API, and the stuck row is visible
through the evidence psql queries (§10). This closes the spec matrix's
silent hole — the plan states it instead of implying infinite retry.

## 6. Cancel — tombstone semantics

`cancelRequest(tx, { approvalRequestId, actor, reason })` is allowed from
`requested`, `starting`, `pending`, `decision_pending` → CAS → `cancelled`
+ `cancel_reason` + audit. Cancellation is a tombstone, not a suggestion:

- The starter re-checks state under the advisory lock immediately before
  the POST (§4 step 3): a cancelled row never starts a process.
- If the POST already landed before the cancel committed, the reconciler's
  tombstone cleanup deletes the engine process (see below). The bridge
  guarantees confirm-safety, not engine-side undo: if a decision already
  completed in the engine before the cancel, history keeps that fact, the
  local row stays `cancelled`, and confirm stays refused (state check).
- A late decision delivery against a cancelled row consumes silently at
  ladder step 1 and completes nothing.
- The reconciler NEVER adopts or attaches a process to a cancelled row.

Tombstone cleanup (reconciler duty): scan `cancelled` rows with
`engine_cleanup_at IS NULL`; query by stored process id / businessKey; if a
process exists, delete it via `client.cancelProcess` and audit; set
`engine_cleanup_at`. Engine unreachable → leave for the next tick.

## 7. Confirm — guarded transition inside the caller's transaction

`confirmApproval(tx, { approvalRequestId, actorSub,
currentLineSnapshotSha256 })` — called by the module (in T06: the fixture
caller) INSIDE its own command transaction:

1. Reconcile-on-read: first run the single-row reconcile for this approval
   (same code path as the reconciler's per-row sync, under the advisory
   lock, its own short transaction). Without this, a confirm issued
   immediately after the engine completes would hit a spurious not-ready
   because the 5s poller has not synced yet.
2. In the caller's transaction: lock the row; resolver recheck of the
   CONFIRMING actor's CURRENT permission (active + warehouse scope superset
   over the row's `warehouse_ids`); `state == 'approved'` (else
   ApprovalNotReadyError → 409); `halt_reason` must be null (state check
   covers it); caller-supplied `currentLineSnapshotSha256` ==
   `line_snapshot_sha256` (else SnapshotMismatchError → 409); CAS
   `approved → confirmed` + `confirmed_by_sub`/`confirmed_at` + audit — all
   in the caller's transaction, so the module's stock effect and the
   confirmation commit or roll back together.
3. [SPEC WINS] The bridge does NOT compare the current document version to
   `submitted_document_version`: workflow-spec-v1 §5 explicitly forbids it
   (approval transitions legitimately advance the document version). The
   content guard is the hash equality; the document `If-Match` check against
   the document's CURRENT version is the module's own duty in its confirm
   handler.

The T06 fixture caller is ADVERSARIAL (Contrarian rule): it stores raw
fixture lines independently, recomputes the JCS + SHA-256 hash from those
lines via the shared contract helper (§8) — never echoes the stored
snapshot — supports mid-flight line edits and version bumps, and performs a
trivial in-transaction effect row so a forced rollback proves atomicity
(request stays `approved`, not `confirmed`). Negative tests are mandatory
(§11). Evidence states plainly: T06 verifies the bridge contract against an
adversarial fixture; end-to-end confirm against the real module is deferred
to the module phase, and the same contract tests must run unchanged against
the real adapter there.

## 8. Files

| File | Change |
|---|---|
| `prisma/migrations/20261120020000_platform_workflow_approval/migration.sql` | DDL in §1 |
| `contracts/events/registry.ts` | Register the two `workflow.approval.*` event payload types against the existing schema files; aggregate type `approval_request` |
| `contracts/events/workflow-approval-started-v1.schema.json`, `...-approved-v1...`, `...-rejected-v1...` | NEW schema files: lifecycle event names + payloads FROZEN now, NOT emitted in T06 (both T04 destinations have empty consumer maps; emitting would only manufacture NO_CONSUMER_REGISTERED dead-letters). Emission starts with the first real consumer (P08/P09). |
| `contracts/workflow/line-snapshot.ts` | Pure helper `computeLineSnapshotSha256(lines)` (JCS canonicalize + SHA-256, reuse the T02 canonicalize dependency). This is a CONTRACT-level utility shared by the future module and the tests; the bridge stores/compares the hash and never calls this in production paths. |
| `platform/workflow/approval-request.ts` | Types, state enum, typed errors (SelfApprovalError, ApprovalScopeError, DecisionConflictError, VersionConflictError, ApprovalNotReadyError, SnapshotMismatchError, HaltedApprovalError) |
| `platform/workflow/approval-repository.ts` | All SQL for the table; CAS transition helper `transition(id, from[], to, patch, expectedVersion)` |
| `platform/workflow/approval-service.ts` | `createRequest`, `recordDecisionIntent`, `cancelRequest`, `confirmApproval`, getters (signatures in §5/§6/§7). No method calls Flowable. |
| `platform/workflow/flowable-starter.ts` | §4 |
| `platform/workflow/flowable-decider.ts` | §5.2 |
| `platform/workflow/reconciler.ts` | §9; exports the single-row reconcile used by confirm (§7 step 1) |
| `composition/event-handlers.ts` | `buildHandlerMap` gains destination `workflow` with the two consumers (amendment, §3) |
| worker entry (the `build:worker` target running the T03 dispatcher) | Start the reconciler loop alongside the dispatcher |
| `tests/platform/run-workflow-bridge.sh` + `tests/platform/workflow-bridge.integration.test.ts` | Suite in §11; npm script `test:platform:workflow-bridge` |
| `documents/phase-plan/workflow-bridge-contract-v1.md` | Contract doc, §10 |
| `documents/phase-plan/evidence/p04-t06.md` | Evidence incl. claims ledger, §10 |
| phase-04 doc | Tick the 3 T06 checkboxes per the claims ledger |

Unit tests beside sources (`approval-service.test.ts`, `reconciler.test.ts`,
`flowable-decider.test.ts` with a fake client) join `npm test`, following
`flowable-client.test.ts`. NO new npm dependencies. NO new required env keys.

Actor resolution: `ActorResolver` port `(sub) => Promise<ApprovalActor |
null>` where `ApprovalActor = { sub, role, warehouseIds, active }`, injected
into the service and the decider; it MUST read current state at call time (a
request-time snapshot silently breaks the revocation rule — the contract
says so). Production wiring in composition reads the real P02 membership by
sub (role/status are real data). Warehouse scope has NO data source yet —
warehouses do not exist — so the wired resolver returns the membership's
scope attribute when present and otherwise an empty set (fail-closed); tests
seed real membership rows (G03 pattern: organization + membership with
keycloak_sub/role/status) and supply fixture scope. The evidence ledger
states exactly this split: authorization LOGIC proven; scope DATA arrives
with the module.

## 9. Reconciler duties (per tick, per row, CAS + audit on every transition)

- `starting` older than 30s with no process id: query runtime + history by
  businessKey → 0 found: leave it (the outbox delivery owns retries; if that
  delivery is dead-lettered, the row is visible via the §10 queries) → 1
  found: verify binding (§4 step 5) and adopt → `pending`; mismatch →
  `halted` `BINDING_MISMATCH` → >1: `halted` `DUPLICATE_PROCESS`.
- `pending`: if `flowable_task_id` is null, fill it from `queryTasks`. If
  the instance has ended, read history: ended WITH decision variables but
  the row has NO recorded intent → `halted` `EXTERNAL_COMPLETION` (never
  launder an out-of-band completion into a normal approval); ended WITHOUT
  decision variables (engine-side cancel/admin action) → `halted`
  `HISTORY_WITHOUT_DECISION`; instance vanished from runtime AND history →
  `halted` `PROCESS_VANISHED`.
- `decision_pending`: query the recorded task → task gone: read history;
  nonce proof matches (§5.1) → sync `approved`/`rejected` (write `decision`,
  `decision_reason`, `approver_sub`, `decided_at`, `engine_completed_at`);
  history shows a completion with different variables → `halted`
  `DECISION_CONFLICT`; no history yet → wait (history lag is not
  cancellation). Task still open → do nothing (the decider owns completion).
  Age > 15 min → structured log `DECISION_STUCK` (alert only; never
  auto-complete from the reconciler).
- `cancelled` with `engine_cleanup_at IS NULL`: tombstone cleanup (§6).
- Orphan sweep (bounded): list runtime instances for process key
  `goods-issue-approval` (paged, cap 200 per tick) and diff businessKeys
  against local rows. Instance whose businessKey has NO local row →
  structured log `workflow.reconcile.orphan_engine_process` + audit note;
  create nothing, delete nothing (a human decides; this is the divergence
  the two-database restore case can produce). Instance for a `cancelled`
  row → handled by tombstone cleanup. Instance still running for a terminal
  local row → log `workflow.reconcile.diverged`, no action.
- Idempotency: re-running the reconciler over a finished process produces
  exactly ONE state transition and ONE audit entry (CAS out of a
  non-terminal state; terminal rows are not scanned).

Structured logging (one convention for the whole bridge, JSON lines, always
carrying `approvalRequestId`, `businessKey`, `processInstanceId`):
`workflow.start.created`, `workflow.start.duplicate_detected`,
`workflow.decision.intent_recorded`, `workflow.decision.dispatched`,
`workflow.reconcile.synced`, `workflow.reconcile.diverged`,
`workflow.engine.unreachable`. The reconcile-synced line also carries
decision latency = engine `decidedAt` − local `decision_requested_at`.
No metrics endpoint, counters, or dashboard — that is T07.

## 10. Contract doc + evidence

`documents/phase-plan/workflow-bridge-contract-v1.md` — "Approval bridge
contract v1 — how a module requests, decides, and reads an approval
(P04-T06)". Sections: (1) what this is / what it is NOT (explicit NOT list:
no UI, no Keycloak→Flowable identity sync, no warehouse scope data, no stock
effects, no webhooks — unauthenticated callbacks are never trusted);
(2) five-minute model: one Mermaid state diagram (§2) + the one rule in
bold — **your module never calls Flowable; you write approval requests and
read local approval state**; (3) requesting an approval (inputs, where
creatorSub comes from, uniqueness: one live approval per documentId,
resubmission after rejection = NEW documentId, businessKey = approval id);
(4) deciding (service surface, validation order, 202/409/422 mapping,
reject-reason rule, replay semantics §5.1); (5) state table + event gloss
table (requested = "start a process for this approval", producer: submit
path, consumer: starter; decision_requested = "a human decided — go tell
the engine", producer: decision path, consumer: decider) + the statement
that v1 supports exactly ONE process definition (`goods-issue-approval`),
bound at latest-deployed-version at start time; (6) failure behaviour a
module must tolerate (decision_pending can revert to pending; decisions can
sit in decision_pending through an outage — never time one out into a local
decision; a dead-lettered decision is revived by T07's admin retry, not by
resubmitting); (7) never-do list (no direct Flowable REST, no completing
tasks, no writing approval rows directly, no polling the engine yourself,
no assuming the engine enforces businessKey uniqueness); (8) the T04
destination amendment (§3); (9) deferred wiring list (HTTP routes, real
warehouse-scope source, Inventory port, lifecycle-event emission);
(10) worked example — the same state timeline as the evidence file;
(11) run the proof yourself (npm script names).

Evidence `documents/phase-plan/evidence/p04-t06.md` contains: the worked
example timeline (timestamp, approval state, engine state, actor) for one
approval from request to terminal; per-scenario excerpts from the suite
(engine-side counts, history dumps, row snapshots — the integration suite
emits a JSON evidence bundle per scenario: deployment id/version, process
instance id, task id, historic-instance dump, local row snapshot after every
transition); the psql operator queries (stuck in starting, stuck in
decision_pending, decision_pending with a dead-lettered decision row, halted
rows); the stuck definitions T07 will reuse (starting unbound > 30s,
decision_pending > 15 min); a statement of whether the suite ran on a fresh
stack, twice, or both; and the CLAIMS LEDGER closing the file — every
phase-doc checkbox sentence → proven / proven at platform-contract level /
not proven — deferred → artifact pointer:

- Checkbox 1 (local approval + outbox on create; worker starts the process
  via idempotent correlation; poller syncs after verifying process/task; no
  webhook): PROVEN.
- Checkbox 2 (Flowable down ⇒ document waits, never auto-approves;
  duplicate/late results never confirm; rejection carries reason + audit):
  PROVEN at bridge level. Note: the design has no approval timeout that
  decides anything; stuck visibility is via DECISION_STUCK + operator
  queries, resolution via T07.
- Checkbox 3 (approver != creator in v1; final confirm checks synced state
  + actor's CURRENT permissions): PROVEN at platform-contract level against
  the adversarial fixture. Warehouse scope is checked with the full set on
  decide, dispatch recheck, and confirm; the scope DATA source arrives with
  the module phase. AC-12 is therefore PARTIALLY addressed by T06
  (deployment id/version, instance/task/history, local states: yes;
  balances before/after: module phase — fixture document version + line
  hash before/after are captured instead).

## 11. Commits (repo style, in order)

1. `feat(p04-t06): approval_request schema and workflow event registration`
2. `feat(p04-t06): approval service — create request in the command transaction`
3. `feat(p04-t06): Flowable starter consumer with query-before-start`
4. `feat(p04-t06): decision intent with application-side authorization checks`
5. `feat(p04-t06): decision worker — verification ladder and lost-response recovery`
6. `feat(p04-t06): reconciler syncing approval state from Flowable history`
7. `feat(p04-t06): confirm gate and cancel tombstone for approvals`
8. `test(p04-t06): workflow bridge integration suite (engine kill, duplicate, late result)`
9. `docs(p04-t06): workflow bridge contract and evidence`

## 12. Verification — integration suite `test:platform:workflow-bridge`

Harness follows `tests/platform/run-workflow.sh` (instance/project args,
deploy + Flowable up, unique UUID fixtures per case, poll with deadlines —
never sleep; a bare 401 is not "engine up"). Assertions that count run
against ENGINE queries after a settle poll, never against log lines. Every
test states whether its fault seam was SEEDED (state prepared directly) or
GENUINELY KILLED (compose stop/start). The four kill quadrants are covered:
engine killed × worker killed, at start × at complete.

| Spec row / trap | Test |
|---|---|
| Happy path approve | createRequest (fixture doc, real JCS hash) → 1 process → recordDecisionIntent → decider completes → reconciler syncs `approved` → confirmApproval passes → `confirmed` |
| Happy path reject | Same with reason → synced `rejected` + reason in row and audit; confirm refused |
| Engine down at start | Stop Flowable → createRequest → state `requested`, zero processes, confirm refused → start Flowable → retries → exactly 1 process, `pending` |
| Worker crash after start, before saving ID (SEEDED) | Start the process directly via the client with the row's businessKey; leave the row in `starting`, process id NULL, aged > 30s → reconciler tick → adopted, runtime count still 1 |
| Duplicate delivery of `requested` | Invoke the starter consumer twice (incl. concurrently) → still 1 process; second delivery no-ops on query-first |
| >1 process for one businessKey (SEEDED) | Start a second process directly via client → reconciler → `halted` DUPLICATE_PROCESS; confirm refused; repeated worker runs change nothing |
| Decoy process adoption (SEEDED) | Process under the same businessKey but wrong definition key / wrong start variables → `halted` BINDING_MISMATCH, not adopted |
| Orphan engine process (SEEDED) | Start a process via client with a random businessKey (no local row) → orphan sweep logs it, creates nothing, deletes nothing |
| Creator self-approve | recordDecisionIntent with actor.sub == creatorSub → SelfApprovalError; intent fields still NULL; ZERO new outbox rows |
| Scope violation | Actor missing one warehouse → ApprovalScopeError; no intent, no outbox |
| Decision replay + conflict | Same intent call twice (same actor/decision/task) → second returns the existing row, still ONE decision_requested row; different decision while pending → DecisionConflictError 409 |
| Reject requires reason | Blank reason → validation error before any write; with reason → full path |
| Lost complete response (SEEDED) | Record intent → complete the task directly via client with the exact nonce variables (simulating the lost response) → decider delivery → query-first finds the task gone, verifies nonce proof in history, completes NO other task (a second request's open task untouched; history shows exactly one completion) |
| Lost response, different outcome (SEEDED) | Complete directly with DIFFERENT variables → decider/reconciler → `halted` DECISION_CONFLICT |
| External completion (SEEDED) | Complete a task via raw client with NO local intent → reconciler → `halted` EXTERNAL_COMPLETION; confirm refused |
| Engine down mid-complete (GENUINE KILL) | Record intent → stop Flowable → decider delivery fails/backoff → state stays `decision_pending`, confirm refused → start Flowable → delivery succeeds → synced terminal state |
| Role revoked before dispatch (SEEDED) | Record intent → flip the resolver so the approver loses a warehouse → decider → intent reset to NULL, state back to `pending`, audit with reason, engine task still open |
| Cancel during start (SEEDED) | Row in `starting`, process started directly via client → cancelRequest → `cancelled` → reconciler tombstone cleanup deletes the engine process; starter delivery afterwards no-ops; confirm refused |
| Cancel of pending + resubmit rules | Cancel a `pending` request → engine process deleted by cleanup → createRequest with the same documentId → unique violation; with a NEW documentId → succeeds |
| Confirm hash drift (adversarial fixture) | Approve fully → fixture edits its lines → confirmApproval with the recomputed (different) hash → SnapshotMismatchError; with the original hash → passes |
| Confirm atomicity (adversarial fixture) | Fixture caller forces a rollback after the gate → row still `approved`, not `confirmed`; effect row absent |
| Confirm reconcile-on-read | Complete the task via the decider path and call confirmApproval IMMEDIATELY (before any reconciler tick) → confirm succeeds (no spurious not-ready) |
| Reconciler idempotency | Run the reconciler 3× over a finished process → exactly one transition, one audit entry |
| Engine restart (GENUINE KILL) | Request `pending` → restart the Flowable container → same flowable_process_id, reconciler continues, decision completes normally |
| Submit retry | createRequest twice with the same documentId + same snapshot → one row, one requested event, one process; same documentId + different snapshot → conflict error |
| Poison start row | Fixture request with a malformed hash (bypassing service validation via direct insert) → starter pre-flight → PermanentDeliveryError, dead-letter after 1 attempt, row `halted` INVALID_START_VARIABLES, zero Flowable calls |

Unit tests (in `npm test`): CAS transition guards; scope-superset and
self-approval validation; replay/conflict branches of recordDecisionIntent;
hash helper against a fixed JCS vector; decider ladder branches against a
fake client (incl. `FlowableUnknownOutcomeError` → query-before-retry);
reconciler sync/halt branches against a fake client.

## 13. OpenCode execution rules (standing)

- Work strictly inside the project dir; never Read/Glob/Grep outside it;
  never read `deploy/instances/*.env`. If a tool call is rejected, skip and
  continue. The untracked plan files in the repo root (p03t06-plan.md …
  p04t06-plan.md) are owner-approved; leave them untouched.
- Minimal or no explanatory comments; SPDX license headers stay (CI
  requires them). Any dependency change must refresh
  `documents/phase-plan/evidence/npm-license-inventory.json` in the same
  commit (this plan adds NO dependencies).
- Commits exactly as §11, in order, one logical scope each. Run `npm test`
  and typecheck before finishing; report honestly what passed.
