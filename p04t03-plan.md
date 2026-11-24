# P04-T03 — Transactional Outbox & Worker: Implementation Plan

**Produced by:** LLM Council (5 advisors → anonymous peer review → chairman synthesis), 2026-11-20.
**Status:** Plan only — no code written. Branch when implemented: `phase04/p04-t03-outbox-worker` from `phase-04`, merge `--no-ff` into `phase-04`, task branch kept (standing team rule).

---

## 1. Authoritative scope (phase doc, quoted)

From `documents/phase-plan/phase-04-workflow-events.md`, section P04-T03:

- [ ] "Migration outbox, payload version, aggregate/correlation/destination; insert trong cùng PG transaction của command."
- [ ] "Worker riêng claim row với lease, backoff+jitter, max attempts, dead-letter và admin retry; gửi sau commit, không gọi HTTP partner trong transaction."
- [ ] "Redis nếu dùng cho coordination/cache không thay PG outbox; kill/restart worker, chứng minh message không mất."
- **Đầu ra:** "dispatcher + metrics/ops API"; **kiểm chứng:** "crash-before/after-send và receiver duplicate tests."

Team dossier row for P04-T03: "`platform/outbox/` PG writer + `workers/outbox-dispatcher.ts`, claim `FOR UPDATE SKIP LOCKED`, lease/backoff/dead-letter; `delivery_attempt` thêm P09." Verification: "Kill worker trước/sau HTTP, restart không mất message; receiver dedupe; Redis mất không mất PG outbox."

Locked blueprint (`documents/phase-plan/database-schema-v1.md` § `platform.outbox_message`, P04):

> `id`, `created_at`; `aggregate_type text!`, `aggregate_id uuid!`, `aggregate_version integer!`, `event_type text!`, `schema_version text!`, `payload jsonb!`, `destination text!`, `correlation_id text!`, `status text! CHECK IN ('pending','leased','retry_due','delivered','dead_letter') DEFAULT 'pending'`, `attempt_count integer! DEFAULT 0 CHECK(attempt_count>=0)`, `next_attempt_at timestamptz! DEFAULT now()`, `lease_owner text?`, `lease_until timestamptz?`, `last_error_code text?`, `delivered_at timestamptz?`. Unique `(aggregate_type,aggregate_id,aggregate_version,event_type,destination)`; partial index `(next_attempt_at,created_at) WHERE status IN ('pending','retry_due')`; index `(correlation_id)`. Worker dùng `FOR UPDATE SKIP LOCKED`, lease hết hạn được reclaim.

`database.md` adds the delivery semantics: a local destination is marked delivered only after handler success; a federation destination only after a valid technical ACK (P09); a crash before marking may re-send, so the receiver/handler must dedupe. Internal event payloads (`event-payloads-v1.md` §2) carry `eventId` inside the payload and the version inside `event_type` (e.g. `trading.receipt.confirmed.v1`); "cùng `(aggregate,version,event_type,destination)` chỉ một row."

**Owed to T03 by T02** (`documents/phase-plan/evidence/p04-t02.md` + phase-doc T02 note): (1) scheduling of `IdempotencyPort.purgeExpired()` — "scheduling belongs to P04-T03"; (2) the literal outbox-row assertion — T02 asserted effect-exactly-once + dispatch-exactly-once via a test double; "Outbox-row assertion chờ P04-T03 tạo bảng outbox; kiểm chứng literal tại G04."

---

## 2. Council verdict

### Where the council agrees (unanimous or near-unanimous)

1. **`DispatchPort` cannot be implemented as designed and must go.** It fires post-commit with only a `requestId` — no event data, no transaction handle. Keeping it as a "wake-up nudge" (one advisor's position) preserves a second, losable signal inside a system whose entire purpose is not losing signals; polling already finds committed rows. All five peer reviewers independently named the nudge the single biggest blind spot in the round. The port, `UnimplementedDispatch`, and the post-commit call in the pipeline's `commit` step are **removed**, with the supersession recorded in T03's evidence — exactly the precedent T02 set when it redesigned T01's idempotency port.
2. **Rows are written inside the domain transaction, structurally** — not by a post-commit step and not by convention.
3. **No HTTP transport in T03.** Delivery is a destination-resolved handler port; building HTTP now invents P09 (which owns the federation envelope, technical ACK, and `delivery_attempt`). The recording/failable test receiver dedupes by message id.
4. **The dispatcher core is a deterministic `tick()`** (claim → deliver → transition), wrapped by a thin polling loop in the **existing** `worker` compose service. No new service.
5. **Scope honesty:** T03 ships an internal `retryDeadLetter(messageId)` function and real `/metrics` counters — **not** a permissioned admin HTTP API (that is T07's row, and an unauthenticated retry endpoint would be a demo-day vulnerability) and not dashboards/alerts (T07).
6. **T02's literal assertion closes in T03's own test suite**, referencing T02's evidence. T02's evidence file is **not** edited (same rule T02 applied to T01's).

### Where the council clashes

1. **Who emits — pipeline-managed vs domain-direct.** One advisor argued the domain must call a tx-scoped writer directly because a pipeline declaration "hides intent and breaks when a command conditionally emits zero or three events." The majority favoured pipeline management mirroring T02's claim/complete. **Chairman's resolution:** the objection only defeats a *static* `CommandOptions` event list. The adopted design is the synthesis of both: the domain registers events dynamically during execution via `ctx.emit(event)` (intent stays in domain code, next to the mutation; zero-to-many events are natural), and the pipeline owns persistence, draining the collected events through the writer inside the same unit-of-work, after the domain function returns and before idempotency `complete`. The tx-scoped writer also exists as a standalone primitive for future non-pipeline writers (e.g. T06's worker-side writes).
2. **Unknown destination — immediate dead-letter vs retryable.** Two advisors said dead-letter immediately ("don't burn retries"); one said retryable. A peer reviewer broke the tie: in T03 *every* destination is initially unregistered, and a handler deployed later should be able to rescue the row. **Resolution:** unknown destination is a retryable failure with `last_error_code='UNKNOWN_DESTINATION'` recorded from attempt 1, dead-lettering after max attempts like any other failure. The dead-letter gauge on `/metrics` (plus structured logs) is what keeps this from becoming the "silent graveyard" the sceptics warned about.
3. **Purge coupling.** Two advisors would fold `purgeExpired()` into the dispatcher tick; three warned that one hang then kills both. **Resolution:** separate timer, same process (see §6).

### Blind spots the council caught in peer review (all adopted)

1. **Fencing.** No advisor's first pass guarded the completion transition. If worker A's lease expires, worker B reclaims and delivers, and A then wakes up and marks the row delivered, A's stale write corrupts B's state. **Adopted:** mark-delivered and mark-failed are compare-and-swap updates predicated on `id`, `status='leased'`, `lease_owner = <worker>`, **and** `attempt_count = <claimed value>` (the attempt count acts as the lease epoch). Zero rows updated ⇒ log `lease_lost`, count nothing.
2. **Database clock.** All lease and due-time math in SQL uses PostgreSQL `now()` — never application clocks — so multi-worker clock skew cannot duplicate or stall claims. The claim predicate explicitly includes expired leases: `status='leased' AND lease_until < now()`.
3. **Dead-letter head-of-line semantics.** Undecided by every advisor: does a dead-lettered v2 block v3 of the same aggregate forever? **Decided:** a dead-lettered row does **not** block its aggregate. The ordering gate (§5) only waits on rows in `pending`/`leased`/`retry_due`. The version gap stays visible (dead-letter state + metrics), and T04 handlers must tolerate gaps — recorded as a contract note for T04. Blocking forever would turn one poison event into a permanent per-aggregate outage.
4. **Retention gap.** `purgeExpired()` covers only idempotency rows; delivered outbox rows would grow unbounded. T03 deliberately does **not** invent a retention policy (none exists in the blueprint); the gap is recorded in T03's evidence as a deferral for the owner to settle (proposal: decide at T07/P12; growth is trivial at current scale). Dead-letter rows are never auto-purged.
5. **Two-worker race test.** Kill/restart tests alone don't prove claim safety; the suite adds a concurrent two-dispatcher test (§8).

### The recommendation (chairman)

Build T03 as: blueprint-exact `platform.outbox_message` + a Prisma writer in `platform/outbox/`; pipeline `ctx.emit` drained in-transaction; `DispatchPort` deleted with evidence supersession; a tick-driven dispatcher (SKIP LOCKED claim, DB-clock leases, fenced transitions, capped exponential backoff with full jitter, max 8 attempts, dead-letter) resolving destinations through a handler port that is **empty in production wiring** until T04/P09 register real destinations; the loop and the idempotency purge timer running as separate timers inside the existing `worker` service; `/metrics` queue gauges made real; T02's deferred literal assertion closed by T03's integration suite.

### The one thing to do first

The migration + schema-test expectations (commit 1). Every other decision — writer shape, claim SQL, fencing — is testable only once the blueprint table exists with its unique constraint and partial index.

---

## 3. Design — storage (commit 1)

- Prisma model `OutboxMessage` in `prisma/schema.prisma`, mirroring `IdempotencyRecord`'s style: `@@schema("platform")`, `@@map("outbox_message")`, `@@unique([aggregateType, aggregateId, aggregateVersion, eventType, destination])`, `@@index([correlationId])`, timestamptz(6) mappings.
- Hand-authored migration in the Prisma Migrate directory (T02 precedent: authored directly, applied with `prisma migrate deploy`; single migration source), next timestamped directory after `20261120000000_platform_delivery_idempotency`, e.g. `20261120010000_platform_delivery_outbox/migration.sql`. The SQL adds what the Prisma DSL cannot express: the `status` and `attempt_count>=0` CHECK constraints and the **partial** due index `(next_attempt_at, created_at) WHERE status IN ('pending','retry_due')`.
- Grants to `app_runtime`: `SELECT, INSERT, UPDATE` — **no DELETE** (nothing in T03 deletes outbox rows; least privilege, and it makes the retention deferral in §2 enforceable rather than accidental). `core_data` receives no grant, mirroring T02.
- `test:platform:schema` expectations extended: table/columns/CHECK/unique/partial-index/grant assertions on both a fresh DB and an upgraded Phase-02/03 DB, plus repeat `migrate deploy` (runner pattern from T02).

## 4. Design — writing rows inside the transaction (commit 2)

**Files:**

- `platform/outbox/message.ts` — **rewritten**. The P00 stub (`OutboxMessage {organizationId, type, payload}`, `Outbox { enqueue }` with no tx) is superseded by blueprint-shaped types:
  - `OutboxEventInput { aggregateType, aggregateId, aggregateVersion, eventType, schemaVersion, payload, destination, correlationId }` — all required; the row id (generated UUID) is the message id receivers dedupe by; the payload's own `eventId` (per `event-payloads-v1.md`) is carried inside `payload`.
  - `OutboxMessage` row type mirroring the table.
  - `OutboxHandler` port: `(message: OutboxMessage) => Promise<void>` — resolve = return, failure = throw.
  - The `Outbox`/`OutboxMessage` exports in `platform/index.ts` are updated to the new types (the stub is used nowhere else; verified by grep before removal).
- `platform/outbox/writer.ts` — `appendOutbox(tx: Prisma.TransactionClient, events: OutboxEventInput[]): Promise<void>` (factory-free, mirrors how the domain step already receives a tx; a `createPrismaOutbox(client)` factory was considered and rejected — the writer is only ever called with a tx). Behaviour:
  - Validates every field present (fail closed inside the tx ⇒ the whole command rolls back, never a partial event).
  - Plain `INSERT` via `tx.outboxMessage.createMany` — **no** `ON CONFLICT DO NOTHING`. A collision on the unique tuple inside the domain tx fails the command loudly; per the blueprint ("chỉ một row" per tuple) a collision means a domain bug or an illegitimate re-confirm, and silently dropping the event would be worse. This behaviour gets its own test (§8).
- `platform/http/pipeline.ts` — `CommandContext` gains `emit(event: OutboxEventInput): void`. Implementation: an events array in the attempt scope (like `scope`/`replayed` today); `ctx.emit` pushes. Inside the existing unit-of-work callback, after `options.domain(...)` returns and after the context-integrity checks, the pipeline calls `appendOutbox(tx, events)` **before** `port.complete(tx, …)`. If the domain throws, the events exist only in memory and die with the rollback — zero rows, by construction. Replayed commands return before the domain step, so a retry can never double-write a row (this is what makes the §8 closure test pass).
- `platform/http/command-ports.ts` — `DispatchPort` and `UnimplementedDispatch` **deleted**; the `commit` step's post-commit dispatch call and `CommandOptions.dispatchPort` are removed. The step registry itself is unchanged (T01's order tests and `onStep` instrumentation keep their meaning; `commit` remains the finalization step). T03's evidence records the supersession of T01's dispatch step and of T02's dispatch-double assertion, exactly as T02's evidence recorded its supersession of T01's port.
- **Test fallout (budgeted, per the council):** `platform/http/pipeline.test.ts` / `idempotency.test.ts` cases that used a dispatch double are reworked to assert emitted rows via a fake writer/clock-free harness; `tests/platform/idempotency.integration.test.ts` loses its dispatch double — its domain function now emits through the pipeline and the "exactly one dispatch" assertion is replaced by the row assertion in the new outbox suite (§8). All other T01/T02 assertions stay byte-identical where possible.

## 5. Design — dispatcher (commit 3)

`platform/outbox/dispatcher.ts` — factory mirroring `createPrismaIdempotency`:

```ts
createOutboxDispatcher({ client, handlers, workerId, leaseMs = 30_000, batchSize = 10,
                         maxAttempts = 8, baseBackoffMs = 2_000, maxBackoffMs = 300_000 })
  → { tick(): Promise<{ claimed, delivered, retried, deadLettered, leaseLost }>,
      stats(): Promise<{ pending, leased, retryDue, deadLetter, delivered }> }
```

- **Claim** (single short transaction, raw SQL — Prisma has no `SKIP LOCKED`):
  ```sql
  UPDATE platform.outbox_message
  SET status='leased', lease_owner=$worker, lease_until=now() + $lease, attempt_count=attempt_count+1
  WHERE id IN (
    SELECT id FROM platform.outbox_message m
    WHERE ((m.status IN ('pending','retry_due') AND m.next_attempt_at <= now())
           OR (m.status='leased' AND m.lease_until < now()))
      AND NOT EXISTS (SELECT 1 FROM platform.outbox_message o
                      WHERE o.aggregate_type=m.aggregate_type AND o.aggregate_id=m.aggregate_id
                        AND o.destination=m.destination
                        AND o.aggregate_version < m.aggregate_version
                        AND o.status IN ('pending','leased','retry_due'))
    ORDER BY m.next_attempt_at, m.created_at
    LIMIT $batch FOR UPDATE SKIP LOCKED)
  RETURNING *
  ```
  The `NOT EXISTS` gate is the per-aggregate ordering rule: a row is claimable only when no lower `aggregate_version` for the same aggregate+destination is still in flight. `delivered` and `dead_letter` predecessors do not block (§2, blind spot 3). No global FIFO; no cross-aggregate head-of-line blocking. All timestamps are the DB's `now()`.
- **Deliver** outside any transaction, sequentially per claimed row: `handlers.get(row.destination)`; missing handler ⇒ failure with code `UNKNOWN_DESTINATION`. Handler resolves ⇒ **mark delivered**; throws ⇒ **mark failed**.
- **Fenced transitions** (both are single SQL updates, 0 rows ⇒ `lease_lost`, log and move on):
  - Delivered: `SET status='delivered', delivered_at=now(), lease_owner=NULL, lease_until=NULL WHERE id AND status='leased' AND lease_owner=$worker AND attempt_count=$claimedAttempt`.
  - Failed: if `attempt_count >= maxAttempts` ⇒ `status='dead_letter'`, else `status='retry_due'` with `next_attempt_at = now() + backoff`, `last_error_code` set, lease cleared — same CAS predicate.
- **Backoff:** `delay = random(0, min(maxBackoffMs, baseBackoffMs * 2^(attempt-1)))` (full jitter), computed in SQL-friendly form (pass the computed interval as a parameter; `now()` still comes from the DB).
- **Structured JSON logs** per outcome (house style): `{service:'outbox-dispatcher', messageId, correlationId, destination, attempt, outcome}` — no payload bodies, no secrets.
- `platform/outbox/admin.ts` — `retryDeadLetter(client, messageId)`: single update `SET status='pending', attempt_count=0, next_attempt_at=now(), last_error_code=NULL WHERE id AND status='dead_letter'`; returns whether a row was reset. Internal function only — no HTTP surface in T03.

## 6. Design — worker wiring & purge scheduling (commit 4)

- `workers/outbox-dispatcher.ts` (dossier-exact path): the production loop module — builds the Prisma client, an **empty** handler registry (see §7), the dispatcher, and runs `tick()` on a 1 s interval with per-iteration try/catch and JSON logs (file-reconciler precedent). Exports a `main()` so the entrypoint can start it.
- **TS execution:** the runner image copies `worker/` as plain JS and cannot import `platform/` TS. Add `npm run build:worker` (`tsc` over `platform/outbox/**`, `platform/http/idempotency.ts` deps, and `workers/**`, outDir `worker/dist`) and a Dockerfile builder step so `worker/dist` lands inside the copied `worker/` tree. Do **not** ship `tsx` to production. (Implementer must verify the exact copy paths against the root Dockerfile — this is the one build detail the council could not fully resolve from the tree alone.)
- `worker/entrypoint.js`: additionally boots the dispatcher loop on startup, and a **separate hourly `setInterval`** that calls `createPrismaIdempotency(prisma).purgeExpired()` with its own try/catch and a `{service:'worker', outcome:'idempotency_purge', deleted}` log line. Separate timer, not dispatcher ticks: a stalled dispatcher must not stall the purge and vice versa. Rationale, recorded for the evidence: T02 deferred the scheduling to T03 without naming a home; the worker is the only always-on platform process, and the two jobs share nothing but the process and the Prisma client.
- `/metrics` on :8081: `worker_queue_depth` stops being `NaN` — it reports `pending + retry_due + leased` from `stats()`; add `worker_outbox_dead_letter` gauge. The existing comment ("Queue has no dispatcher until P04") is removed. Compose file unchanged — same `worker` service, same env (`DATABASE_URL` already present).

## 7. Delivery target — what "delivered" honestly means in T03

- The handler port is the seam: T04 will register local handlers (trace projector etc.) through composition; P09 will register a federation HTTP transport that marks delivered only on a valid technical ACK and writes `delivery_attempt`. Neither is built here.
- **Production wiring in T03 registers zero handlers.** Nothing writes outbox rows in production until the first real command producer (P05+) either, so an empty registry is the correct state, not a broken one. Any row that nevertheless appears dead-letters visibly with `UNKNOWN_DESTINATION` after max attempts.
- In tests, the receiver is a recording double that dedupes by message id (row id), can be told to fail N times, and can succeed-then-simulate-crash-before-mark. T03's evidence will call this **simulated delivery against the handler port** — the crash/duplicate proofs are real; no production consumer is claimed.

## 8. Tests (commit 5)

New suite wired exactly like T02's: `tests/platform/run-outbox.sh` (disposable `postgres:17.6`, bootstrap, `prisma migrate deploy`, `node --test`), registered in `scripts/run-platform-test.mjs` and `package.json` as `test:platform:outbox`. Cases:

1. **Atomic write:** command whose domain emits 2 events commits ⇒ 2 rows with correct aggregate/version/destination/correlation; domain throws after emit ⇒ 0 rows and 0 effects.
2. **Unique-tuple collision:** emitting the same tuple twice in one tx fails the command; no partial rows.
3. **T02 closure (the literal assertion):** 20 concurrent same-key commands through the real pipeline, domain emits one event ⇒ exactly 1 domain effect, 1 completed idempotency row, **exactly 1 outbox row**; a sequential retry replays and still leaves 1 row. Dispatcher then delivers it exactly once to the deduping receiver.
4. **Crash-before-send:** tick claims a row, process/tick aborts before the handler runs; lease expires (test advances `lease_until` in SQL); next tick reclaims and delivers once.
5. **Crash-after-send:** handler succeeds, mark never happens (simulated crash); redelivery occurs; receiver dedupe by message id ⇒ one effective delivery, row ends `delivered`.
6. **Real kill/restart:** spawn the loop as a child process against the disposable DB, enqueue 20 rows, SIGKILL mid-batch, restart, assert 20 delivered / 0 lost (the phase doc's kill/restart proof — a mocked abort is not accepted as a substitute).
7. **Two-worker race:** two dispatcher instances tick concurrently over N rows ⇒ disjoint claims (SKIP LOCKED), each row delivered exactly once.
8. **Fencing:** worker A claims; lease is force-expired; worker B reclaims and delivers; A's late mark-delivered affects 0 rows and is logged `lease_lost`.
9. **Backoff & dead-letter:** handler always fails ⇒ attempts follow the backoff curve (assert `next_attempt_at` ordering/windows, not exact jitter), row lands in `dead_letter` at attempt 8 with `last_error_code` preserved; `retryDeadLetter` resets it to `pending`/attempt 0 and a healthy handler then delivers it.
10. **Ordering gate:** v3 is not claimed while v2 is `retry_due`; after v2 dead-letters, v3 becomes claimable (gap tolerated, per §2).
11. **Purge schedule:** with the purge timer driven directly, expired idempotency rows are deleted and unexpired/`processing` rows are untouched.
12. **Unknown destination:** row with no registered handler retries with `UNKNOWN_DESTINATION` and dead-letters at max attempts; never marked delivered.

Regression: `test:platform:idempotency`, `test:http`, `test:platform:schema` all green after the pipeline/port changes.

## 9. Evidence & checkbox honesty (commit 6)

- `documents/phase-plan/evidence/p04-t03.md` records: implementation summary; the DispatchPort supersession (and the T02 dispatch-double supersession); the delivery-target honesty note (§7); the dead-letter-unblocks-successors decision and its T04 contract implication; the retention deferral; the purge-home rationale; verification results with the actual commands.
- Phase-doc checkboxes:
  - Checkbox 1 (migration + in-tx insert): **tick** — fully delivered.
  - Checkbox 2 (worker claim/lease/backoff/dead-letter/admin retry; post-commit send; no HTTP in tx): **tick with a note** — admin retry is delivered as the internal `retryDeadLetter` function + test; the permissioned admin API is T07's own row ("Admin xem/retry theo quyền" in P04-T07) and is not built here.
  - Checkbox 3 (Redis does not replace PG outbox; kill/restart ⇒ no loss): **tick** — Redis is not used anywhere in the design; the SIGKILL/restart test is the proof.
  - Add the T02-note closure: a dated note under P04-T03 stating the literal outbox-row assertion now exists and passes in `test:platform:outbox`, ready for formal verification at G04. `evidence/p04-t02.md` itself is **not** edited.
- Refresh `documents/phase-plan/evidence/source-inventory.json` for new source files (SPDX check in `npm test`); no dependency changes are expected, so `npm-license-inventory.json` should not need a refresh — and avoid gitleaks-bait fixture strings in tests (T02 lesson: the fake key `"valid-key-12345678"` tripped CI secret-scan).

## 10. Commit breakdown (in order)

1. `feat(p04-t03): add platform.outbox_message migration` — Prisma model + hand-authored migration (CHECKs, partial index, grants) + schema-test expectations.
2. `feat(p04-t03): write outbox rows inside the command transaction` — `platform/outbox/message.ts` rewrite + `platform/outbox/writer.ts` + pipeline `ctx.emit`/in-tx drain + `DispatchPort` removal + T01/T02 unit-test rework (`test:http` green).
3. `feat(p04-t03): add outbox dispatcher with lease, backoff and dead-letter` — `platform/outbox/dispatcher.ts` (claim SQL, fencing, backoff, stats) + `platform/outbox/admin.ts` (`retryDeadLetter`).
4. `feat(p04-t03): run dispatcher and idempotency purge in the worker service` — `workers/outbox-dispatcher.ts` loop + `worker/entrypoint.js` boot/purge timer/real metrics + `build:worker` + Dockerfile step.
5. `test(p04-t03): add outbox PostgreSQL integration tests` — `tests/platform/run-outbox.sh` + `tests/platform/outbox.integration.test.ts` + runner/`package.json` wiring + minimal T02 integration-test update (dispatch double → emit).
6. `docs(p04-t03): evidence and phase checkboxes` — `documents/phase-plan/evidence/p04-t03.md` + phase-04 doc ticks/notes + `source-inventory.json` refresh.

## 11. Verification (implementer's checklist)

- `npm run test:platform:schema` — fresh + upgraded DB, repeat deploy.
- `npm run test:platform:outbox` — all §8 cases.
- `npm run test:platform:idempotency` — regression after the port removal.
- `npm run test:http` — pipeline contract tests incl. emit ordering.
- `npm test` (full: SPDX, licenses, secrets, contracts, identity, gateway, transaction, audit, http) and `npm run typecheck`; `npx prisma validate` + `npm run db:generate`.
- Stack smoke (manual, post-merge): `docker compose --profile apps up worker` on a disposable stack ⇒ `/metrics` shows real `worker_queue_depth`; insert a row by hand ⇒ dispatcher log shows the `UNKNOWN_DESTINATION` retry path (no handlers registered in production wiring).

## 12. Open questions for the owner

1. **Dead-letter unblocking (chairman's call, flippable):** a dead-lettered v2 does not block v3+ of the same aggregate; T04 handlers must tolerate version gaps. Flip to block-until-admin-retry if the team wants strict per-aggregate ordering instead.
2. **Delivered-row retention:** no purge in T03 (no blueprint policy; dead-letter rows never auto-purged). Confirm deferring the decision to T07/P12.
3. **Tunables:** lease 30 s, batch 10, max attempts 8, backoff 2 s → 300 s full jitter, poll 1 s, purge hourly — all constants in the dispatcher factory; confirm or tune before G04.
4. **Worker TS build:** the plan adds a `tsc` build step so `workers/outbox-dispatcher.ts` + `platform/outbox/*` run inside the existing JS worker image (dossier path kept, no `tsx` in production). Confirm the Dockerfile change is acceptable, or direct the dispatcher entry to live as plain JS under `worker/` instead.
5. **Checkbox-2 note wording:** "admin retry" is split — internal function now (T03), permissioned API in T07. Confirm the phase-doc note may say so when the box is ticked.
