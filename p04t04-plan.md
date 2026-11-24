# P04-T04 — Event handlers và ownership: Implementation Plan

**Produced by:** LLM Council (5 advisors → anonymous peer review → chairman synthesis), 2026-11-20.
**Status:** Awaiting owner approval. Planning only — no code written yet.
**Branch (to create):** `phase04/p04-t04-event-handlers` from `phase-04`.

---

## 1. Authoritative scope (phase doc, verbatim intent)

From `documents/phase-plan/phase-04-workflow-events.md`, section P04-T04:

- [ ] Định nghĩa type/version cho `trading.receipt.confirmed`, `issue.confirmed`, `transfer.confirmed`, `receiving.confirmed`, `sale.recorded`; event nội bộ khác federation envelope.
- [ ] Wire handler ở `composition/` để Traceability/Federation tiêu thụ qua port, không import domain context khác; lỗi handler có retry và dead-letter.
- [ ] Không phát event truy xuất cho Draft hoặc transaction rollback.
- **Đầu ra:** event registry/contract tests; **kiểm chứng:** một confirm→một event cùng source document ID.

AI-assignment table row for T04: `contracts/events/*.schema.json` cho event nội bộ trong `event-payloads-v1.md`; handler registry ở `composition/`; versioned serializer. Verification: Confirm một lần→một event source/version; Draft/rollback→0; unknown version dead-letter có metric.

**Scope boundaries (do NOT swallow):** T05 = Flowable deploy; T06 = app↔Flowable bridge (owns the `workflow.*` event handlers); T07 = observability + permissioned admin retry API + dashboards/alerts; T08 = Gate G04. P07 = trading emitters. P08 = Trace projector consumer. P09 = federation transport/ACK/inbox. **No production route migration** (first business consumers are P05+/P09).

## 2. Repo reality (verified by reading the code before convening)

- **The event contracts already exist.** `contracts/events/*.schema.json` (P00) contains all five trading schemas (`trading-receipt-confirmed-v1.schema.json`, `…-issue-…`, `…-transfer-…`, `…-receiving-…`, `…-sale-recorded-…`), both workflow schemas, and `envelope-v1.schema.json`; fixtures include `fixtures/domain-events-v1.json` (valid/invalid payload per event) and `fixtures/invalid/unknown-version.json`. `scripts/validate-contracts.mjs` (Ajv2020 + ajv-formats) already validates them under `test:contracts` in `npm test`. Checkbox 1 is therefore about pinning these into a **runtime** registry + serializer, not authoring schemas.
- **Locked payload shapes** (`documents/phase-plan/event-payloads-v1.md` §2): event types carry the version suffix — `trading.receipt.confirmed.v1`, `trading.issue.confirmed.v1`, `trading.transfer.confirmed.v1`, `trading.receiving.confirmed.v1`, `trading.sale.recorded.v1`. Owners: receipt → Trace projector; issue → Trace projector; transfer → Federation outbound + trace; receiving → Trace + business receipt back to sender; sale → Trace + downstream impact. Rule: *"Consumer biết version hỗ trợ, không gọi handler v1 cho payload v2 chưa có adapter"* — a consumer must never be invoked for an unsupported version.
- **Schemas mandate the fields the design relies on** (peer-review asked; verified): each trading schema requires `eventId` (uuid), `documentId`, `documentVersion`; the outbox row itself carries `aggregateVersion` as a column.
- **The delivery port today** (`platform/outbox/message.ts`): `OutboxHandler = (message: OutboxMessage) => Promise<void>`; dispatcher (`platform/outbox/dispatcher.ts`) takes `Map<destination, OutboxHandler>`. A handler error with a string `code` property is recorded in `last_error_code`, else `DELIVERY_FAILED`. **All** failures retry uniformly (full-jitter backoff 2s→300s, max 8 attempts) → `dead_letter`. Unknown destination retries as `UNKNOWN_DESTINATION`. Ordering gate: a lower `aggregate_version` in pending/leased/retry_due blocks successors for the same aggregate+destination; **dead_letter does not block**. Marking delivered is a fenced update *after* the handler returns — handler effects are **not** atomic with the marking (at-least-once).
- **Production wiring today:** `workers/outbox-dispatcher.ts` passes `handlers: new Map()` (empty). Worker build `tsconfig.worker.json` includes only `workers/outbox-dispatcher.ts`, `platform/outbox/*.ts`, `platform/http/idempotency.ts` — adding composition/contracts imports requires extending the include list (same wrinkle T03 solved for its own files). The runner image does **not** copy `contracts/` — runtime file-reads of schemas would break in the container; importing the JSON schemas from a TS module lets `tsc` emit them into `worker/dist` (see §5, D5).
- **No production emitters exist.** `ctx.emit` is exercised only in tests (`platform/http/pipeline.test.ts` uses `eventType: "test.created.v1"`, `schemaVersion: "1"`, `destination: "local"`). No trading module exists yet (P07). Audit is written synchronously inside the pipeline transaction — it is **not** an outbox consumer and T04 must not invent one.
- **No dedupe ledger in the blueprint.** `documents/database-schema-v1.md` defines `platform.outbox_message` (P04), `federation.inbox_message` + `delivery_attempt` (P09), `traceability.trace_event` with unique `(issuer_instance_id, external_event_id)` (P08). There is no generic processed-message table. P08-T02's own plan already specifies its projector as `workers/trace-projector.ts` doing an **idempotent upsert** of `core_record(kind='trace_projection')` keyed by source — natural-key idempotency is the downstream design.
- **Dead-letter replay primitive already exists** (T03): `platform/outbox/admin.ts` `retryDeadLetter(messageId)` resets a dead-lettered row to pending. Permissioned API + audit = T07. Delivered/dead-letter retention was already deferred to T07/P12 by T03.
- **T03's handoff to T04** (`evidence/p04-t03.md`): *"A dead-letter predecessor does not block successors; P04-T04 handlers must tolerate version gaps and inspect dead-letter metrics."*
- **composition/ pattern:** factory wiring modules (`composition/audit.ts` exports `auditHttpDependencies()`); `architecture.md` assigns composition/ the role *"Wire port, transaction và event handler"*; platform must not import composition/ (`composition/context-map.ts` comment).
- **ajv, ajv-formats, canonicalize are already runtime dependencies** (moved there by T02). No new dependency is needed; if that changes, refresh `documents/phase-plan/evidence/npm-license-inventory.json` in the same commit.
- **Deployment shape:** ERP app (future emitter side) and worker (consumer side) ship in the **same image/release** (one root `Dockerfile`, worker = compose service of the same build, command `node worker/entrypoint.js`). Producer/consumer version skew is limited to brief rolling-restart windows.

## 3. Council verdict

### Where the council agrees
- **D2:** Unknown version and invalid payloads are deterministic, not transient — retrying them 8× is poison (wasted budget + head-of-line blocking of same-aggregate successors via the ordering gate). Fail-fast to dead-letter, with a metric. **Unanimous.**
- **D5:** Never persist an invalid event — validate on the emit side, inside the transaction, so a bad payload fails the command and writes zero outbox rows. Delivery-side validation is a backstop, not the primary fence.
- **Delivered-after-validation is silent data loss** and is rejected by every advisor but one and by every peer review. Unconsumed events must be preserved, never discarded.
- **No exactly-once is on offer.** At-least-once + non-atomic handler effects is the physics; a ledger does not change it, because the ledger mark is itself not atomic with the handler's own effects.
- **D6:** Blocking successors on a dead-lettered predecessor is worse than a version gap (4–1).

### Where the council clashes
- **D1 (3–2):** Native dispatcher routing by (destination, eventType, schemaVersion) [Contrarian, Expansionist] vs composition routing wrapper [First Principles, Outsider, Executor].
- **D3 (3–2):** Processed-message ledger now [Contrarian, Expansionist] vs contract-only idempotency [First Principles, Outsider, Executor].
- **D4 (three-way):** Production map stays empty [First Principles, Contrarian] vs register both destinations, unconsumed → dead-letter [Outsider, Executor] vs register + archive-then-deliver [Expansionist — rejected by all reviews].
- **D5 placement:** Serializer in platform beside `ctx.emit` [Executor] vs beside the schemas in the contracts layer [Contrarian, First Principles, Outsider].
- **D6:** Contrarian alone would revisit T03 (gap = silently wrong history).

### Blind spots the council caught (peer review)
- **Dead-letter lifecycle was undefined by all five advisors** — replay trigger, retention, ownership. Resolved from repo facts: `retryDeadLetter` exists (T03); admin API/dashboards/retention already belong to T07/P12. T04 supplies the failure signal and uses the primitive; it builds no operator tooling.
- **Replay is out-of-order delivery.** Replaying v2 after v3 was consumed breaks naive consumers. The answer is a **consumer version guard** (never regress a newer stored version with a stale replay), not blocking successors.
- **Deployment skew:** fail-fast could dead-letter a legitimate new version emitted during a rollout. Mitigated by the same-image release (§2) — skew is a brief restart window, and `retryDeadLetter` after rollout recovers casualties. No grace-period machinery in T04.
- **Schema field assumptions — verified true** (§2): `eventId`, `documentId`, `documentVersion` are required; `aggregateVersion` is an outbox column.
- **Ledger ≠ event store.** A dedupe table gives P08 no history to backfill from; the Expansionist's archive conflated two different systems.

### The recommendation (chairman — decides every point)

- **D1 — Composition routing wrapper; dispatcher stays dumb.** `composition/` builds the destination→handler `Map`; each destination handler validates and routes internally by `(eventType, schemaVersion)` to per-event consumers. Platform learns nothing about event types and imports nothing from composition. Per-event observability is emitted inside the wrapper (structured log keyed by eventType/schemaVersion/reason), meeting the native-routing camp's metrics concern without inverting layering.
- **D2 — Fail-fast permanent failures via one explicit signal.** A handler throws a permanent error → dispatcher dead-letters **immediately** (attempt 1), records the specific reason, skips backoff and remaining retries. Transient errors keep T03's uniform retry. Skew casualties are recovered with `retryDeadLetter` — documented as a T07 operational note, not coded as a grace period.
- **D3 — Contract-only idempotency. No ledger, no migration in T04.** The port contract states it plainly: delivery is at-least-once, duplicates *will* happen, consumers key work by `payload.eventId` and upsert by natural key (`documentId + documentVersion`). Enforced by contract test (deliver twice → one effect), and aligned with P08's own projector design. If a real P08/P09 consumer proves it needs a ledger, it builds one then, with real keying/retention known.
- **D4 — Register both destinations in production; unconsumed (type, version) → permanent dead-letter.** An empty map is not honesty: the first real P07 event would burn 8 retries as `UNKNOWN_DESTINATION` for destinations the blueprint already names. Register `traceability` and `federation` routing handlers now; a known event with no consumer implementation yet dead-letters on attempt 1 — preserved, replayable via `retryDeadLetter` when P08/P09 land, successors unblocked. Never delivered-after-validation. Zero emitters today ⇒ this costs nothing and loses nothing.
- **D5 — Validate both sides, emit side first; serializer beside the schemas.** A versioned serializer module lives with the contracts (`contracts/events/`), co-located and versioned with the five JSON Schemas, importable by both the ERP emitter side and the worker without platform importing composition. Emit side validates inside the transaction (invalid → command fails → zero outbox rows). Delivery side (the routing wrapper) re-validates before invoking any consumer — the second fence for rows that bypassed the emit path (hand-written rows, older writers).
- **D6 — Confirm T03. Do not reopen it.** Dead-letter does not block successors. The Contrarian's fear is answered by obligation, not blocking: the port contract requires consumers to check `aggregateVersion`/`documentVersion` explicitly, detect jumps (gap), and version-guard upserts so a replayed predecessor cannot regress current state. T03's tests stand untouched.

**One thing first:** the permanent-error signal in the dispatcher. D2 is this signal, D4's preserve-don't-lose behaviour is this signal, and D6's unblocked successors only work if poison exits the retry path at once.

## 4. Design

### 4.1 Permanent-error signal (platform — the only dispatcher change)

`platform/outbox/message.ts` (or a new `platform/outbox/errors.ts`):

```ts
export class PermanentDeliveryError extends Error {
  readonly code = "NON_RETRYABLE";
  constructor(readonly reason: string, message?: string) { super(message ?? reason); }
}
```

Error taxonomy (`reason`, all permanent):
- `UNSUPPORTED_EVENT_TYPE` — eventType base is not one of the five registered trading types (and not a known future type; see classification rule below).
- `UNSUPPORTED_EVENT_VERSION` — known type base, unsupported version (eventType suffix ≠ `.v1`, or `schemaVersion !== "1"`).
- `INVALID_EVENT_PAYLOAD` — known type+version, payload fails its JSON Schema.
- `NO_CONSUMER_REGISTERED` — known, valid event, but no consumer implementation registered for that (destination, type, version) yet.

Classification rule for the version check: strip a trailing `.v<digits>` suffix from `eventType`; if the base is a registered type but the suffix/`schemaVersion` is not the supported one → `UNSUPPORTED_EVENT_VERSION`; if the base itself is unknown → `UNSUPPORTED_EVENT_TYPE`.

Dispatcher change (`platform/outbox/dispatcher.ts`, minimal and additive): in the existing catch block, after computing `errorCode`, detect permanence — `error instanceof PermanentDeliveryError` **or** `error.code === "NON_RETRYABLE"` (duck-typing keeps test doubles simple, mirroring the existing `error.code` convention). If permanent: take the existing dead-letter branch immediately regardless of `attemptCount` (skip the backoff computation), with `last_error_code = error.reason ?? "NON_RETRYABLE"`. All other behaviour — claiming, fencing, ordering gate, UNKNOWN_DESTINATION retry, stats — is unchanged. T03's suites must pass unmodified except for added cases.

"Metric" for unknown version (phase-doc wording) in T04's honest form: (a) the row lands in `dead_letter` on attempt 1 with `last_error_code = UNSUPPORTED_EVENT_VERSION`; (b) the dispatcher's structured per-message log line records outcome `dead_letter` on attempt 1; (c) the routing wrapper emits its own structured log line with `eventType`, `schemaVersion`, `destination`, `reason` before throwing; (d) the existing worker `/metrics` dead-letter count (from T03 stats) reflects it. Dashboards/alerting on top are T07 — the evidence file must say so.

### 4.2 Versioned serializer + event registry (contracts layer)

New module `contracts/events/registry.ts`, co-located with the schemas:

- Imports the five trading schema JSON files directly (`import receiptV1 from "./trading-receipt-confirmed-v1.schema.json"` etc.) and compiles them once with Ajv2020 + ajv-formats — the same setup as `scripts/validate-contracts.mjs`. JSON imports make `tsc` emit the schemas into `worker/dist/contracts/events/…`, so the worker container needs **no** Dockerfile change and **no** runtime file reads. (Requires `resolveJsonModule` in the worker tsconfig and in the root tsconfig if it type-checks this module — implementer verifies; T03 already extended `tsconfig.worker.json` includes the same way.)
- Exports:
  - `EVENT_DESTINATIONS = { traceability: "traceability", federation: "federation" } as const` — the canonical destination strings. (The blueprint names the owners, not the strings; T04 fixes the strings here so P07 emitters and P08/P09 consumers share one source.)
  - `TRADING_EVENT_TYPES` — the five full type strings with `.v1` suffix; supported `schemaVersion` is `"1"` (matching the existing emit-test convention `test.created.v1` / `"1"`). Deliberately distinct from the federation envelope's `schemaVersion: "1.0"` — internal events ≠ federation envelope (checkbox 1).
  - Default fan-out per type (from `event-payloads-v1.md` §2 owners): receipt → `[traceability]`; issue → `[traceability]`; transfer → `[traceability, federation]`; receiving → `[traceability, federation]`; sale → `[traceability, federation]`. (Receipt's "không federation nếu nhập nội bộ" condition is a P07 business decision; the emitter may pass explicit destinations to override the default.)
  - `serializeDomainEvent(input: { type, payload, aggregateType, aggregateId, aggregateVersion, correlationId, destinations? }): OutboxEventInput[]` — validates the payload against the type's schema (throws a validation error listing ajv errors — on the emit path this fails the command), then returns one `OutboxEventInput` per destination with `eventType` = full `.v1` string and `schemaVersion: "1"`.
  - `validateDomainEvent(eventType, schemaVersion, payload): { ok: true } | { ok: false; reason }` — the delivery-side check used by the routing wrapper; applies the classification rule in §4.1, then the ajv schema.
- The two `workflow.*` schemas are **not** registered here — their handlers belong to T06's Flowable bridge. A workflow event arriving at the traceability/federation destinations classifies as `UNSUPPORTED_EVENT_TYPE` at those destinations, which is correct: it was misrouted.

Emit-side usage (the pattern P07 will follow; T04 proves it in tests): domain code inside a command calls `serializeDomainEvent(...)` and passes each result to `ctx.emit(...)`. Validation happens at the `ctx.emit` call site, inside the transaction → throw → rollback → zero outbox rows. `appendOutbox` and the pipeline stay generic and unchanged (generic/test events like `test.created.v1` to destination `local` keep working — the serializer governs the five trading types only).

### 4.3 Composition registry + routing handler

New file `composition/event-handlers.ts` (following the `composition/audit.ts` factory precedent):

```ts
export type EventConsumer = (message: OutboxMessage) => Promise<void>;
export type EventConsumerMap = Map<string, EventConsumer>; // key: `${eventType}` (full .v1 string)
export function createRoutingHandler(destination: string, consumers: EventConsumerMap): OutboxHandler;
export function buildHandlerMap(consumers?: { traceability?: EventConsumerMap; federation?: EventConsumerMap }): Map<string, OutboxHandler>;
```

`createRoutingHandler` behaviour, in order:
1. `validateDomainEvent(message.eventType, message.schemaVersion, message.payload)` → not ok: structured log line (`service: "event-router"`, messageId, correlationId, destination, eventType, schemaVersion, reason) then `throw new PermanentDeliveryError(reason)`.
2. Look up the consumer by `message.eventType` in this destination's consumer map → missing: log + `throw new PermanentDeliveryError("NO_CONSUMER_REGISTERED")`.
3. Invoke the consumer. Its errors propagate untouched — transient errors retry under T03 policy; a consumer may itself throw `PermanentDeliveryError` for its own deterministic failures.

**The port contract** (documented in the file header and in the evidence — this is the D3/D6 obligation, stated brutally):
- Delivery is at-least-once. Your consumer **will** receive the same message more than once (crash after your effect, before the delivered-marking).
- Key your work by `payload.eventId`; upsert by natural key (`documentId + documentVersion`). Never append blindly.
- Versions of one aggregate arrive in order *except* across a dead-letter: a predecessor may be dead-lettered and replayed **after** you consumed its successor. Check `aggregateVersion` / `payload.documentVersion` explicitly, detect jumps, and never let a stale (replayed) event regress newer stored state.
- Throw transient errors for transient problems (they retry, max 8, then dead-letter). Throw `PermanentDeliveryError` only for failures that can never succeed.

`buildHandlerMap()` with no arguments is the **production** wiring: both destinations registered, both consumer maps empty (real consumers land in P08/P09 and are passed in there — by their own composition wiring, without importing other domain contexts).

### 4.4 Worker wiring

- `workers/outbox-dispatcher.ts`: `handlers: buildHandlerMap()` replaces `handlers: new Map()`.
- `tsconfig.worker.json`: extend `include` with `composition/event-handlers.ts` and `contracts/events/registry.ts` (their transitive imports — `platform/outbox/*`, ajv — are already covered/available). `npm run build:worker` must stay green.
- Behaviour change, stated plainly: previously any row (none can exist yet) would retry 8× as `UNKNOWN_DESTINATION`; now rows for the two blueprint destinations validate and dead-letter fast if unconsumed. No emitters exist, so there is no observable production change today.

### 4.5 What T04 deliberately does NOT ship

- No real Trace/Federation consumer bodies (P08/P09), no trading emitters (P07), no workflow handlers (T06), no Flowable anything (T05/T06).
- No dedupe ledger table / migration (D3).
- No admin retry API, dashboards, alerts, retention policy (T07/P12) — `retryDeadLetter` from T03 is the replay primitive.
- No changes to the federation envelope, inbox, or ACK (P09).
- No production route migration.

## 5. Tests

New integration suite `test:platform:events` wired exactly like `test:platform:outbox` (`tests/platform/events.integration.test.ts` + the `scripts/run-platform-test.mjs` suite registration + `tests/platform/run-events.sh` if that is the mechanism the outbox suite uses — follow the existing pattern file-for-file). Real PostgreSQL, disposable database, like the other platform suites.

1. **Confirm → one event, same source document ID:** a real `runCommand` pipeline command whose domain uses `serializeDomainEvent` for `trading.receipt.confirmed.v1` → exactly 1 outbox row; `event_type = trading.receipt.confirmed.v1`, `schema_version = "1"`, destination `traceability`, `payload.documentId` = the source document's ID, `payload.eventId` present.
2. **Fan-out:** `trading.transfer.confirmed.v1` → exactly 2 rows (traceability + federation), same `payload.eventId`, distinct row IDs (the T03 unique tuple).
3. **Draft/no-emit → 0 rows; rollback → 0 rows:** a command that never calls the serializer/emit writes nothing; a command that emits then throws (rollback) writes nothing.
4. **Emit-side validation:** `serializeDomainEvent` with a payload missing a required field (use the invalid case from `fixtures/domain-events-v1.json`) inside a command → command fails, 0 outbox rows.
5. **Unknown version dead-letters fast, successors proceed:** insert a row `trading.receipt.confirmed.v2` / `schemaVersion "2"` (aggregate version 1) and a valid v1 row (aggregate version 2, same aggregate+destination) directly in the DB; run the production `buildHandlerMap()` dispatcher → row 1 is `dead_letter` after exactly **1** attempt with `last_error_code = UNSUPPORTED_EVENT_VERSION`; row 2 is then claimed (gate unblocked) and dead-letters as `NO_CONSUMER_REGISTERED` — assert both, proving the gate opened.
6. **Invalid payload row** (direct insert, bypassing emit) → `dead_letter`, attempt 1, `INVALID_EVENT_PAYLOAD`.
7. **Unknown type row** (`trading.unknown.v1`) → `dead_letter`, attempt 1, `UNSUPPORTED_EVENT_TYPE`.
8. **Routing + transient failure isolation:** registry with recording test consumers for both destinations → each consumer receives only its own (destination, type); a consumer that throws a plain `Error` retries and dead-letters only after max attempts (use a small `maxAttempts` dispatcher setting), while the other destination's copy of the same event delivers normally.
9. **Duplicate delivery → one effect (D3 proof):** a reference consumer whose effect is an upsert into a test table keyed by `eventId` (test-fixture SQL, mirroring `tests/platform/transaction-fixture.sql` precedent); deliver the same message twice (invoke the routing handler twice with the same `OutboxMessage`, simulating crash-after-effect) → exactly one effect row.
10. **Version guard / replay gap (D6 proof):** reference consumer upserts by `(documentId, documentVersion)` and records the highest applied version; deliver v3, then replay v2 → stored state remains v3 (no regression) and the consumer's gap/replay detection is asserted; also deliver v1-dead-lettered → v2 delivered, asserting the consumer observed the version jump.
11. **Serializer unit tests** (no DB, plain `node --test` alongside the platform unit tests or inside the events suite): every `valid` fixture in `fixtures/domain-events-v1.json` serializes; every `invalid` fixture throws; type/version string mapping is exact.

Regression gate: `npm test`, `npm run typecheck`, `npm run build:worker`, `npm run test:contracts`, `npm run test:http`, `npm run test:platform:schema`, `npm run test:platform:idempotency`, `npm run test:platform:outbox` all pass (T03's outbox suite gains the permanent-error case; nothing in it may be weakened).

## 6. Evidence + checkbox honesty

New file `documents/phase-plan/evidence/p04-t04.md` (mirroring p04-t02/p04-t03 style): decisions D1–D6 with the council's reasoning in brief, the error taxonomy, the port contract, what is simulated vs real (all consumers in tests are reference consumers; production consumer maps are empty by design until P08/P09), and the deferral list (admin API/dashboards/retention → T07/P12; workflow handlers → T06; emitters → P07; consumers → P08/P09).

Phase-doc checkboxes — all three ticked, each with an honest note:
- **Checkbox 1 — tick with note:** schemas and payload shapes predate T04 (P00, `event-payloads-v1.md`); T04 pins them into the runtime registry/serializer (`.v1` type strings, `schemaVersion "1"`, internal ≠ federation envelope).
- **Checkbox 2 — tick with note:** registry + routing handlers wired in `composition/`, worker consumes `buildHandlerMap()`; transient handler errors retry, deterministic ones dead-letter fast. Consumer *implementations* for Traceability/Federation register into this port in P08/P09 — no consumer bodies exist in T04 because those modules don't exist yet.
- **Checkbox 3 — tick with note:** proven at framework level by contract tests (no-emit → 0 rows, rollback → 0 rows, through the real pipeline); enforcement for real documents lands with the P07 emitters that only emit on confirm.

## 7. Commit breakdown (logically scoped, in order)

Branch `phase04/p04-t03-outbox-worker` precedent → new branch `phase04/p04-t04-event-handlers` from `phase-04`.

1. `feat(p04-t04): permanent delivery error signal in outbox dispatcher` — `PermanentDeliveryError` + dispatcher fail-fast branch + added cases in the outbox integration suite (permanent error dead-letters on attempt 1; transient behaviour unchanged).
2. `feat(p04-t04): versioned serializer and event registry beside the contracts` — `contracts/events/registry.ts` (types, destinations, fan-out, ajv validators, serialize/validate) + serializer unit tests + any tsconfig `resolveJsonModule` adjustment it needs.
3. `feat(p04-t04): event handler registry and routing in composition` — `composition/event-handlers.ts` (`createRoutingHandler`, `buildHandlerMap`, port-contract documentation, structured router log).
4. `feat(p04-t04): wire event handlers into the outbox worker` — `workers/outbox-dispatcher.ts` uses `buildHandlerMap()`; `tsconfig.worker.json` include extension; `build:worker` green.
5. `test(p04-t04): event handler contract tests on PostgreSQL` — `tests/platform/events.integration.test.ts` + suite wiring (`test:platform:events`).
6. `docs(p04-t04): evidence and phase checkboxes` — `documents/phase-plan/evidence/p04-t04.md`; phase-04 doc T04 checkboxes ticked with the §6 notes. (Refresh the license-inventory in this or the relevant commit only if a dependency actually changed — none is expected.)

## 8. Verification steps (implementer's checklist)

1. `npm run test:platform:events` — all cases in §5 pass on a real DB.
2. `npm run test:platform:outbox`, `test:platform:idempotency`, `test:platform:schema`, `npm run test:http`, `npm run test:contracts` — no regressions.
3. `npm test` and `npm run typecheck` — green.
4. `npm run build:worker` — green; the emitted `worker/dist` contains the compiled composition/contracts modules and the schema JSONs.
5. Manual smoke (optional, disposable stack): start the worker service; insert a valid `trading.sale.recorded.v1` row by hand; observe it dead-letter on attempt 1 with `NO_CONSUMER_REGISTERED` and the router log line — the production wiring behaving exactly as designed pre-P08.

## 9. Open questions for the owner

1. **Destination strings:** the blueprint names owners (Trace projector, Federation outbound) but never the literal destination strings. T04 fixes them as `"traceability"` and `"federation"` in `contracts/events/registry.ts`. Confirm — P07 emitters and P08/P09 consumers will all depend on these constants.
2. **Dual version convention:** internal events carry the version in the type string (`trading.receipt.confirmed.v1`) *and* `schemaVersion: "1"` in the outbox row, while the federation envelope uses `schemaVersion: "1.0"`. T04 locks the internal convention as-is (it matches the schemas and the existing emit tests). Confirm this deliberate difference is intended.
3. **Unconsumed = dead-letter as the holding pen:** known, valid events with no consumer yet dead-letter on attempt 1 and wait for `retryDeadLetter` (T03 primitive; T07 will add the permissioned API). The alternative — leaving them pending until P08/P09 — was rejected because a pending predecessor blocks its aggregate's successors. Confirm the dead-letter queue is the accepted holding pen.
4. **Receipt fan-out default:** registry default for `trading.receipt.confirmed.v1` is `[traceability]` only; sending a federation copy is the emitter's explicit override (the payload doc's "không federation nếu nhập nội bộ" condition is a business decision). Confirm the default.
5. **Schema loading mechanism:** T04 imports the JSON schemas from the TS registry module (tsc emits them into `worker/dist`; no Dockerfile change, no runtime file reads). The alternative — reading `contracts/events/*.schema.json` from disk at runtime — would require adding `COPY contracts` to the runner image. Confirm the import approach.
