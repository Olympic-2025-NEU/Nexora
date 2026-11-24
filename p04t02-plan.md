# P04-T02 — Implementation Plan: Idempotency cho lệnh ghi (Idempotency for write commands)

**Status:** Council-approved plan, ready for implementation (OpenCode executes, Milo verifies).
**Repo:** Olympic-2025-NEU/Nexora, branch `phase-04`, clone `~/nexora-clean-check`.
**Method:** LLM Council (5 advisors → anonymous peer review → chairman synthesis), grounded in repo research on 2026-11-20.

---

## 1. Authoritative scope (verbatim from `documents/phase-plan/phase-04-workflow-events.md`)

> ## P04-T02 — Idempotency cho lệnh ghi
>
> - [ ] Migration `idempotency_record` theo `database.md`; scope key theo actor/client + route/action, payload hash, expiry và response reference.
> - [ ] Đồng thời hai request cùng key chỉ một transaction tạo effect; cùng key khác payload trả 409; retry sau timeout trả kết quả cũ, không tạo outbox mới.
> - [ ] Phân biệt idempotency của user command và dedupe của federation inbox, không dùng một cache Redis làm nguồn duy nhất.
> - **Đầu ra:** idempotency adapter; **kiểm chứng:** parallel/retry tests với DB assertions.

AI dossier row for T02:

> | P04-T02 | SQL `0002_platform_delivery.sql` `idempotency_record`; PG adapter `platform/http/idempotency.ts`, key/hash/expiry theo baseline. | 20 request đồng thời cùng key chỉ một effect; cùng key khác body 409; timeout/retry nhận response gốc, không outbox trùng. |

Locked schema blueprint (`documents/phase-plan/database-schema-v1.md`, § `platform.idempotency_record` (P04)):

> `id`, `created_at`; `actor_or_client text!`, `method text!`, `route_key text!`, `idempotency_key text!`, `payload_sha256 char(64)!`, `state text! CHECK IN ('processing','completed','failed')`, `response_status smallint?`, `response_body jsonb?`, `resource_id uuid?`, `expires_at timestamptz!`. Unique `(actor_or_client,method,route_key,idempotency_key)`; index `(expires_at)`. Giữ row/lock trong transaction command; completed response trả lại khi retry, cùng key khác hash 409. Chốt retention ở P04, không xóa đang processing.

Supporting contract facts:

- `database.md` §2: platform `idempotency_record` — "`(actor_or_client, route, key)` unique, payload hash, response reference/status, expiry; key cũ payload khác phải 409".
- `database.md` §4 + `prisma-migration-spec.md` (D03): **Prisma Migrate is the single migration source** (`prisma/migrations/`, timestamped folders). The dossier's "`0002_platform_delivery.sql`" is the logical delivery migration name, not a literal file. Content order: platform core → **delivery (idempotency/outbox/approval)** → system → … T03 adds the outbox in its own migration; T02's migration creates **only** `idempotency_record`.
- `api-payloads-v1.md`: "Stable across retries; reuse with different payload returns 409" (OpenAPI generator, `IdempotencyKey` header, minLength 16 / maxLength 128). Error envelope `{code, message, requestId}`; `error-mapping.ts` passes DomainError 409s through unchanged.
- P03 precedents to reuse, not reinvent: file upload dedupe (`services/core-data/files/upload-service.mjs`) hashes `[method, route, actor.sub, key]` + payload hash, unique index, mismatch → `IDEMPOTENCY_CONFLICT` 409; core records validate the key as `[A-Za-z0-9._:-]{16,128}` and derive scope from `(actor.sub, key)`. Those are service-local dedupes with different owners — T02 does **not** reuse their storage, only their conventions (hash format, key regex, error code name).
- Federation inbox dedupe (`(issuer, messageId, payloadHash)`, P09) stays a separate mechanism. No Redis anywhere in T02.

What T01 shipped (the ground T02 builds on): `runCommand` in `platform/http/pipeline.ts`, step registry `["authenticate","resolve-tenant","authorize","idempotency","domain","commit"]`; domain runs inside the Prisma UoW (`platform/persistence/transaction.ts`, Serializable, maxWait 2s / timeout 10s, ≤2 retries only on P2034/40001/40P01); `IdempotencyPort` in `platform/http/command-ports.ts` is `reserve(key, actorId, action): Promise<void>` / `complete(key, result): Promise<void>`, called **before** the tx opens and **after** it commits; `UnimplementedIdempotency` throws (fail-closed). The header comment in command-ports.ts states: "T02 owns persistence and replay semantics" — revising this interface is inside T02's mandate.

---

## 2. Council Verdict

### Where the Council Agrees (high confidence)

- **The current port is unusable for the acceptance criteria.** `reserve(...): Promise<void>` has no payload-hash input (so the 409-on-mismatch criterion is unimplementable) and no return value (so replay is unimplementable). All 5 advisors: reserve must return a verdict — `reserved | replay(result) | in-flight | conflict` — and take the payload hash.
- **Replay must short-circuit.** On a completed record, `runCommand` returns the stored result without running the domain step, the commit step, or dispatch.
- **The blueprint schema is adopted exactly** — columns, unique tuple, CHECK states, `expires_at` index. No schema invention.
- **Hashing must be central and canonical**, not caller-supplied ("trust-me hashing — a buggy caller defeats conflict detection"). The pipeline receives the payload and hashes it (JCS canonical JSON + SHA-256). (One dissent — the Executor — noted in Clashes.)
- **No production route is migrated in T02** (consistent with T01's deliberate deferral; first real consumers are P05+ / P09). The adapter is proven through contract + DB integration tests with a test consumer.

### Where the Council Clashes

1. **Transaction boundary — the decisive clash (4 vs 1).** The Contrarian, First Principles, Expansionist and Outsider all hold that T01's reserve-before / complete-after split has an unfixable crash window: domain tx commits → process dies before `complete()` → effect exists but the record sits in `processing` → a retry can neither replay (no stored response) nor safely re-execute. That directly breaks the phase-doc criterion "retry sau timeout trả kết quả cũ". The blueprint sentence "giữ row/lock trong transaction command" says the record belongs **inside** the command transaction. The Executor alone defended keeping T01's structure (avoid rework, accept + document the window). **Chairman sides with the majority:** the acceptance criteria and the locked blueprint both fail under the split; the rework is contained (see §3) and T01's public step registry + contract tests survive it.
2. **In-flight duplicate: immediate 409 vs wait-then-replay.** Executor/Contrarian/Outsider: immediate 409 (bounded waits make the 20-way test flaky). Expansionist/First Principles: duplicates should end up replaying. **Chairman: both outcomes are reconciled by the in-transaction claim** — a duplicate's claim INSERT blocks on PostgreSQL's unique index until the winner's transaction resolves (no app-level polling, no timing-dependent test), then conflicts-out and re-reads the now-`completed` row and replays. Immediate 409 survives only as a defensive fallback code (`IDEMPOTENCY_IN_PROGRESS`) if the state is still unresolved after one re-lookup.
3. **Different payload after a failure.** First Principles: allow it — a rolled-back attempt persisted nothing, so there is no promise to protect. Contrarian/Executor/Expansionist: 409 even after failure. **Chairman sides with First Principles under this design:** rollback erases claim + effect atomically, and dispatch is post-commit only (T01/T03 design), so the Contrarian's "partial external dispatch" scenario cannot occur inside T02's boundary. After a **completed** record, different payload → 409 until expiry (unanimous).
4. **TTL:** 24h (Contrarian/Executor/First Principles/Outsider) vs 7 days (Expansionist, arguing partner replay windows). **Chairman: 24h.** Federation partners do not use this table (the P09 inbox is their mechanism); no consumer exists yet that needs longer. Revisit when P05 lands a real consumer.
5. **Cleanup:** ship the purge capability now vs defer entirely. **Chairman splits it:** `purgeExpired()` ships on the adapter in T02 (plus a test); *scheduling* it defers to T03's worker / ops.
6. **Hash input:** caller passes a precomputed hash (Executor) vs pipeline hashes the raw payload (majority). **Chairman: majority** — `CommandOptions` gains `payload?: unknown`; the adapter owns `hashPayload()` (JCS via the already-present `canonicalize` 5.1.0 dependency + SHA-256, the same canonicalization family the repo uses for federation hashes).

### Blind Spots the Council Caught (peer review, unanimous themes)

- **Two clocks were conflated in one `expires_at`** (processing lease vs completed retention). Under the in-transaction design this dissolves: a `processing` row is never committed (a crashed process rolls its transaction back), so there is no stuck-processing takeover problem and no lease is needed. `expires_at` is retention only. *Recorded caveat:* if any future design writes `processing` rows outside a transaction, it must add a short lease + CAS takeover — do not reuse `expires_at` for that.
- **Replay must not bypass authorization.** The Expansionist suggested returning replays before authorize — rejected. T01's step order already runs authenticate → resolve-tenant → authorize **before** the idempotency step, so every replay is re-authenticated, re-tenant-resolved and re-authorized against current policy. The plan keeps that order inviolate.
- **A unique-violation inside a PostgreSQL transaction poisons it.** The in-transaction claim must use `INSERT … ON CONFLICT DO NOTHING` semantics (Prisma `createMany({ skipDuplicates: true })` or `$executeRaw`), never a bare insert whose error aborts the UoW callback.
- **Tenant scope.** No tenant column exists in the blueprint and `database.md` forbids a multi-org tenancy model (one DB per instance/org). Scope is carried by `actor_or_client` (user `sub` or partner `clientId` — exactly what the pipeline already passes) plus the resolve-tenant mismatch check that runs before the idempotency step. A different actor can never reach another actor's row.
- **Crash testing.** Concurrency tests alone are not enough; the integration suite includes a rollback-after-claim case (domain throws → claim + effect vanish → same-key retry succeeds), which is the testable form of the crash window.
- **Atomicity covers PostgreSQL effects only.** External side effects stay safe because dispatch remains post-commit (T03 outbox); T02 must not introduce any in-transaction external call.

### The Recommendation

Implement T02 as: **blueprint-exact Prisma migration + a redesigned port whose claim and completion execute inside the domain transaction + a Prisma adapter in `platform/http/idempotency.ts` + pipeline rework that adds a read-only replay pre-check and in-transaction claim/complete + contract and DB-integration tests. No route migration, no Redis, no fail() hook (rollback replaces it), 24h retention, purge function shipped but unscheduled.**

### The One Thing to Do First

**Commit 1 — the migration and Prisma model** (§5). Every later piece (adapter, tests, evidence) depends on the table existing with the exact blueprint shape, and the schema integration test expectations land in the same commit so the schema suite stays green.

---

## 3. Design (chairman's synthesis — the decisions implementers follow)

### D1 — Storage: new table, exactly per blueprint

- Prisma model `IdempotencyRecord` in `prisma/schema.prisma` with `@@schema("platform")`, `@@map("idempotency_record")`, field maps: `actorOrClient → actor_or_client`, `routeKey → route_key`, `idempotencyKey → idempotency_key`, `payloadSha256 → payload_sha256` (`@db.Char(64)`), `responseStatus → response_status` (`@db.SmallInt`), `responseBody → response_body` (Json), `resourceId → resource_id` (`@db.Uuid`), `expiresAt → expires_at` (`@db.Timestamptz(6)`), `createdAt → created_at`.
- One Prisma migration (slug `platform_delivery_idempotency`) containing the CREATE TABLE plus the CHECK constraints Prisma DSL cannot express (state enum, `payload_sha256 ~ '^[0-9a-f]{64}$'`) as raw SQL in `migration.sql`, following the pattern of `20261119000000_file_upload_idempotency`.
- Grants in the same migration, mirroring `20261118020000_platform_core_audit_grant` / baseline role names: `GRANT SELECT, INSERT, UPDATE, DELETE ON platform.idempotency_record TO app_runtime;` (DELETE is needed by `purgeExpired()`; UPDATE by complete/takeover). **No grant to `core_data`** — the core-data service keeps its own P03 dedupe and is not a pipeline consumer.
- Rejected alternatives: reusing the attachment hash columns (wrong owner, file-service-local); a Redis cache as source of truth (explicitly forbidden by checkbox 3); a hand-written `0002_*.sql` runner (violates the D03 single-source rule).

### D2 — Port redesign (`platform/http/command-ports.ts`)

```ts
export type IdempotencyScope = {
  key: string;
  actorOrClient: string;   // userId (user actor) or clientId (partner actor) — as T01 already derives
  method: string;          // options.method ?? "POST"
  routeKey: string;        // options.routeKey ?? options.action
  payloadSha256: string;   // sha256 of JCS-canonical payload, computed by the pipeline
};

export type LookupOutcome =
  | { kind: "fresh" }
  | { kind: "replay"; result: unknown };

/** Internal signal: a concurrent transaction holds the claim. Never mapped to a client response directly. */
export class IdempotencyClaimLostError extends Error { … }

export interface IdempotencyPort {
  /** Read-only pre-check outside any transaction. Throws DomainError IDEMPOTENCY_CONFLICT (409) on hash mismatch. */
  lookup(scope: IdempotencyScope): Promise<LookupOutcome>;
  /** INSERT … ON CONFLICT DO NOTHING inside the caller's tx. Throws IdempotencyClaimLostError when 0 rows inserted. */
  claim(tx: Prisma.TransactionClient, scope: IdempotencyScope): Promise<{ recordId: string }>;
  /** Marks the claimed row completed with the domain result, inside the same tx. */
  complete(tx: Prisma.TransactionClient, recordId: string, result: unknown): Promise<void>;
  /** Housekeeping: delete rows past expires_at. Not called by the pipeline. */
  purgeExpired(now?: Date): Promise<number>;
}
```

- `UnimplementedIdempotency` is updated to the new interface and still throws on every method (fail-closed preserved). `DispatchPort` / `UnimplementedDispatch` are untouched (T03).
- There is deliberately **no `fail()`/`abandon()`**: domain failure rolls the transaction back and the claim row vanishes with it (D5).

### D3 — Pipeline changes (`platform/http/pipeline.ts`)

- `CommandOptions` gains: `payload?: unknown`, `method?: string`, `routeKey?: string`. Everything else unchanged; the step registry array is **not** modified.
- **Idempotency step** (only when `idempotencyKey !== undefined`, as today): validate the key (`/^[A-Za-z0-9._:-]{16,128}$/`, else `DomainError("IDEMPOTENCY_KEY_INVALID", 400)`); build the scope (actor id exactly as T01 derives it; `payloadSha256 = hashPayload(options.payload ?? null)`); call `port.lookup(scope)`:
  - `replay` → stash the stored result, set an internal `replayed` flag. The domain and commit handlers become no-ops; `runCommand` returns the stored result. Authenticate/resolve-tenant/authorize have already run — replay never bypasses them, and dispatch never fires for a replay.
  - `fresh` → proceed.
- **Domain step**: inside the existing UoW callback, in this order: (1) `port.claim(tx, scope)`; (2) `options.domain(...)` (unchanged); (3) `port.complete(tx, recordId, value)`. Claim + effect + stored response commit or roll back **atomically** — this is the blueprint's "giữ row/lock trong transaction command" made literal.
  - On `IdempotencyClaimLostError`: it must escape the UoW unretried (it carries no P2034/40001/40P01 code, so `transaction.ts` will not retry it — verify in tests). The runner then re-runs `lookup` once: `replay` → return stored result; `fresh` (the winner rolled back) → re-run the whole command **once**; conflict → the lookup throws the 409. If still unresolved → `DomainError("IDEMPOTENCY_IN_PROGRESS", 409)` as a defensive fallback.
- **Commit step**: no longer calls `complete()` (completion is in-transaction now). Dispatch behavior is byte-for-byte T01's (post-commit, errors logged, never rolling back committed work).
- No key supplied → behavior identical to T01. Key supplied but no adapter injected → `UnimplementedIdempotency` throws (fail-closed), as today.
- T01's six contract tests must pass unmodified.

### D4 — Concurrency semantics (what the acceptance test proves)

- The claim is a single `INSERT … ON CONFLICT DO NOTHING` on the unique tuple. A concurrent duplicate's insert **blocks on the unique index** until the winner's transaction commits or rolls back (PostgreSQL speculative insertion), then returns 0 rows → `IdempotencyClaimLostError` → re-lookup → replay of the winner's stored response. No polling loops, no sleeps, no app-level waiting in the implementation.
- Case table (scope = actor + method + routeKey + key):
  | Stored state | Same payload hash | Different payload hash |
  | --- | --- | --- |
  | none / expired | claim + execute | claim + execute |
  | completed (unexpired) | replay stored result verbatim | **409 `IDEMPOTENCY_CONFLICT`** |
  | rolled-back attempt (no row) | claim + execute | claim + execute |
- HTTP mapping (per `api-payloads-v1.md` + `error-mapping.ts`): replay → the original command result (the future route maps it to the same status/body as the first execution, by construction); mismatch → 409 `IDEMPOTENCY_CONFLICT`; invalid key format → 400 `IDEMPOTENCY_KEY_INVALID`; defensive in-flight fallback → 409 `IDEMPOTENCY_IN_PROGRESS`. All are `DomainError`s, which the existing mapper already passes through.

### D5 — Failure semantics

- Domain error or tx failure → rollback erases claim, effect, audit and (future) outbox rows together → **the key is not poisoned**: a later retry with the same key + payload re-executes; the same key with a *different* payload is also accepted (nothing was ever recorded).
- The blueprint's `failed` state is **not written by T02's main path** — rollback makes it unnecessary. Deterministic-failure replay (storing 4xx outcomes as completed) is deferred to the first real consumer (see Open Questions). The CHECK constraint still ships with all three states, per blueprint.

### D6 — Expiry, takeover, cleanup

- `expires_at = created_at + 24h`, set at claim time inside the transaction.
- An expired `completed` row is treated as absent: `lookup` returns `fresh`; if `claim`'s insert conflicts with that expired row, the adapter takes it over **inside the same transaction** with a conditional update (`UPDATE … WHERE id = ? AND expires_at < now()` resetting state/payload hash/response/expiry) and proceeds — the takeover is atomic with the new effect.
- `purgeExpired()` deletes rows with `expires_at < now()` (expired `processing` rows cannot exist committed — see Blind Spots). Scheduling the purge is **deferred to T03's worker / ops**; T02 ships the function + a test only.

### D7 — Payload hashing and key validation

- `hashPayload(payload: unknown): string` exported from `platform/http/idempotency.ts`: JCS-canonicalize (`canonicalize` package, already a dependency) → SHA-256 hex (lowercase, 64 chars). Key-order independence is unit-tested.
- The pipeline — never the caller — computes the hash from `CommandOptions.payload`. Routes (P05+) must pass the exact parsed body they hand to the domain; this is documented in the adapter's JSDoc.
- Key format: `/^[A-Za-z0-9._:-]{16,128}$/` (P03 records precedent + OpenAPI contract).

### D8 — Wiring scope

- **No production route is migrated.** Deliverable wiring = the adapter factory `createPrismaIdempotency(client: PrismaClient)` in `platform/http/idempotency.ts`, injectable through the existing `idempotencyPort` option, plus a reference consumer inside the integration test only.
- `complete()` stores `response_body` = the domain result as JSONB (replayed verbatim as the command result) and `resource_id` when the result is an object whose `id` is a UUID string. `response_status` stays NULL in T02 — the pipeline is transport-agnostic and has no HTTP status; the column is nullable by blueprint design (see Open Questions).

---

## 4. Files

**Create:**
- `prisma/migrations/<timestamp>_platform_delivery_idempotency/migration.sql` (via `prisma migrate dev --name platform_delivery_idempotency`, then hand-add CHECK/GRANT SQL per prior-migration pattern)
- `platform/http/idempotency.ts` — Prisma adapter (`lookup`/`claim`/`complete`/`purgeExpired`), `hashPayload`, key validation, `createPrismaIdempotency` factory
- `platform/http/idempotency.test.ts` — unit tests (hashing, validation, verdict mapping with a fake client)
- `tests/platform/idempotency.integration.test.ts` — DB integration tests (concurrency/replay/conflict/rollback/takeover/purge)
- `tests/platform/run-idempotency.sh` — harness, following the `run-records.sh` / `run-unit-of-work.sh` pattern
- `documents/phase-plan/evidence/p04-t02.md` — evidence file, following `evidence/p04-t01.md` format

**Modify:**
- `prisma/schema.prisma` — add `IdempotencyRecord` model (platform schema)
- `platform/http/command-ports.ts` — new `IdempotencyPort` (D2); `UnimplementedIdempotency` updated; dispatch port untouched
- `platform/http/pipeline.ts` — D3 changes only; step registry and no-key behavior unchanged
- `platform/http/pipeline.test.ts` — extend with replay/claim-ordering/claim-lost tests; existing tests untouched
- `tests/platform/schema.integration.mjs` — add `idempotency_record` table/column/constraint expectations
- `scripts/run-platform-test.mjs` — add `idempotency` entry
- `package.json` — add `"test:platform:idempotency"` and `"test:http"` (`node --test --require tsx/cjs platform/http/pipeline.test.ts platform/http/idempotency.test.ts`); add `test:http` to the default `test` script (closes a T01 gap: pipeline tests are not in the default suite today)
- `documents/phase-plan/phase-04-workflow-events.md` — tick T02 checkboxes + add the dated note (commit 6 only, after tests pass)

**Explicitly untouched:** `app/api/v1/federation/events/route.ts` (P09), `services/core-data/**` (P03 dedupe stays as-is), `platform/persistence/transaction.ts`, `platform/http/error-mapping.ts` (already passes 409 DomainErrors through), the `commandPipeline` registry array.

Every new/modified source file keeps the `// SPDX-License-Identifier: AGPL-3.0-only` header (`check:spdx` runs in CI).

---

## 5. Commit breakdown (one commit per finished piece, in order)

1. `feat(p04-t02): add platform.idempotency_record migration` — `prisma/schema.prisma` model + migration (table, unique, CHECKs, grants) + `tests/platform/schema.integration.mjs` expectations.
2. `feat(p04-t02): redesign IdempotencyPort with lookup/claim/complete verdicts` — `platform/http/command-ports.ts` + `platform/http/pipeline.ts` (replay pre-check, in-transaction claim/complete, `payload`/`method`/`routeKey` options).
3. `feat(p04-t02): add Prisma idempotency adapter` — `platform/http/idempotency.ts`.
4. `test(p04-t02): pipeline replay and claim contract tests` — `platform/http/pipeline.test.ts` additions + `platform/http/idempotency.test.ts` + `package.json` `test:http` wiring.
5. `test(p04-t02): idempotency DB integration tests` — `tests/platform/idempotency.integration.test.ts` + `run-idempotency.sh` + `scripts/run-platform-test.mjs` + `package.json` script.
6. `docs(p04-t02): evidence and phase checkboxes` — `documents/phase-plan/evidence/p04-t02.md` + T02 checkboxes/note in the phase-04 doc.

Task branch `phase04/p04-t02-idempotency` off `phase-04`; merge `--no-ff` into `phase-04` after verification; task branch is KEPT (standing team rule).

---

## 6. Verification steps

1. `npm run test:http` — T01's six tests pass unmodified; new tests prove: replay short-circuits (domain + dispatch spies never called; steps stop after `idempotency`); claim receives the same `tx` as the domain and runs before it; `complete` runs before the UoW commit marker; claim-lost → re-lookup → replay; conflict maps to 409 via `mapCommandError`; key supplied without adapter still throws (fail-closed).
2. `npm run test:platform:idempotency` — against the isolated test Postgres, with DB assertions:
   - **20 concurrent** `runCommand` calls, same key + payload → domain effect executed **exactly once** (effect/audit row count = 1), dispatch spy = 1, all 20 calls resolve to the identical result, exactly **1** `idempotency_record` row in state `completed`.
   - Sequential retry after completion → replay, effect count still 1.
   - Same key, different payload → 409 `IDEMPOTENCY_CONFLICT`, effect count unchanged.
   - Domain throws after claim → rollback: no record row, no effect; same-key retry then succeeds (key not poisoned).
   - Expired completed row (backdate `expires_at`) → same key re-executes via takeover; `purgeExpired()` removes expired rows and never touches unexpired ones.
   - Different actor, same key → independent execution (scope isolation).
3. `npm run test:platform:schema` — new table expectations pass.
4. `npm test` (full default suite: SPDX, licenses, secrets, contracts, identity, gateway, transaction/audit unit, now incl. `test:http`) + `npm run typecheck` + targeted ESLint on touched files — all green.
5. `git diff` sanity: federation route, core-data services, transaction and error-mapping files untouched; CI green on the task branch and on `phase-04` after merge.

**Checkbox honesty (for commit 6 / evidence):**
- Checkbox 1 (migration per `database.md`) — **tick** when commit 1 + schema test pass.
- Checkbox 2 (concurrency / 409 / retry-replay / no new outbox) — **tick** when the integration suite passes, with one honest caveat recorded in evidence: the outbox table itself lands in T03, so "không tạo outbox mới" is asserted as *domain effect exactly once + dispatch invoked exactly once*; the literal outbox-row assertion becomes possible at G04.
- Checkbox 3 (distinct from federation inbox; no Redis source of truth) — **tick**: separate table/port by construction; no Redis anywhere.
- T01's two open checkboxes stay open (still no production route consumer). G04 is not claimed.

---

## 7. Open questions for the owner

1. **Retention = 24h** (blueprint says "chốt retention ở P04" — this plan settles it at 24h). The Expansionist argued 7 days for partner replay windows; partners actually use the P09 inbox, not this table. Confirm 24h, or set 7d now to avoid revisiting at P05?
2. **`failed` state unused in T02.** Rollback erases failed claims, so nothing is ever stored as `failed`, and deterministic domain failures (4xx) are *not* replayed — a retry re-executes and fails again identically. Accept this deferral to the first real consumer (P05), or store deterministic failures now?
3. **`method` / `routeKey` defaults.** Until P05 routes exist, the adapter stores `method = "POST"` and `routeKey = action` (e.g. `trading:goods-issue:create`), both overridable via `CommandOptions`. Accept — or leave the columns to be backfilled by the first route (they are `NOT NULL` in the blueprint, so a default is required)?
4. **`response_status` stays NULL in T02**; replay is verbatim at the command-result level (`response_body`), and the future route re-derives the HTTP status when it maps the result. Accept?
5. **T01 supersession.** This plan deliberately reworks T01's reserve-before/complete-after internals in favor of the locked blueprint. T01's step registry, `runCommand` signature (one additive optional field), and contract tests are preserved, but the description in `evidence/p04-t01.md` becomes historical. The p04-t02 evidence will record the supersession — confirm that's the right paper trail (vs. amending the T01 evidence file).
