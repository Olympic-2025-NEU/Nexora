# P04-T07 — Observability and Operations Permissions: Implementation Plan

_Council-convened plan (5 advisors, 5 peer reviews), chairman synthesis. Approved by Thịnh: pending._
_Branch: `phase04/p04-t07-observability` from `phase-04` (HEAD d807a00 after T06)._

## 0. Spec (phase-04 doc, P04-T07)

- [ ] Metrics pending/retry/dead outbox, process pending/failed, latency; logs carry requestId, messageId, processId, secrets redacted.
- [ ] Admin view/retry by permission; retry audited; NO editing already-emitted payloads, NO manual mark-delivered without basis.
- [ ] Runbook for stuck queue/process handling; threshold alerts based on real test failures.
- **Deliverable row:** Metrics `outbox_pending/dead`, `workflow_pending/failed`, latency; `app/admin/retries` via a use case; dead-letter runbook.
- **Acceptance:** inject one dead message + one stuck process → alert contains the message/process ID; Admin retry has audit; Staff gets 403.

## 1. Council outcome

- **Peer verdict:** Executor = strongest (4 of 5 reviewers; First Principles the fifth vote). First Principles' framing adopted: T07 is a read model plus one guarded write. Expansionist = biggest blind spot (3 reviewers): Idempotency-Key stored-replay machinery with no storage behind it, alerts coupled to a metrics scrape that may never happen, stateless alert dedup that is impossible without state. Contrarian faulted (2 reviewers) for dropping the admin view the spec explicitly requires and for scrape-coupled alerts.
- **Unanimous:** on-scrape SQL counts (no counters, no metrics table); `workflow_failed` = `halted` only (rejected is a business outcome); latency = oldest-pending age gauges, never histograms; retry = the existing `retryDeadLetter` primitive + audit in ONE transaction; alert = a named structured log line carrying IDs + runbook thresholds (no Alertmanager exists; do not pretend otherwise).
- **Peer-review additions (adopted):** (a) a negative leakage test — a secret-like sentinel seeded in a payload/error must appear NOWHERE in metrics output, admin responses, alert lines, or audit records; (b) alert scan runs in the worker (a process that actually runs), not coupled to scrapes; (c) the scan emits a per-cycle completion line so a dead scan is itself visible; (d) engine-side stuck/orphan processes are NOT covered by local-table metrics — T06's reconciler already logs `workflow.reconcile.orphan_engine_process`; T07 references it in the runbook and records the deferral instead of building engine checks.

## 2. Ground truth (verified in repo, 2026-11-20)

- `app/api/v1/metrics/route.ts` exists (Next app router), emits only `service_up`, uses `log`/`requestId` from `platform/observability/health.ts`; `platform/observability/readiness.ts` has `databaseReady()`.
- `platform/outbox/admin.ts` holds the internal `retryDeadLetter(client, messageId)` primitive (single UPDATE, dead_letter→pending, returns boolean) with the comment "Permissioned API and audit belong to P04-T07". Reuse it; do not write a second UPDATE.
- `platform/outbox_message` statuses: pending, leased, delivered, dead_letter (+ attempt_count, last_error_code, correlation_id, destination, aggregate fields). `platform.approval_request` states: requested, starting, pending, decision_pending, approved, rejected, confirmed, cancelled, halted (+ halt_reason, flowable_process_id).
- Routes live under `app/api/v1/` (health, metrics, audit-logs, federation/*, me). Follow the session/membership pattern of `app/api/v1/audit-logs/route.ts` and `app/api/v1/me/route.ts` exactly.
- Permissions: `platform/access/policy.ts` + `scope.ts` (P02). Membership has a role field ('staff' exists). The retry permission check MUST go through the policy module — no hardcoded role-string compare in the route. If the policy model has no admin/operations permission yet, add the constant there.
- Audit writing exists in `platform/audit/` and is used transactionally elsewhere; follow that pattern.
- Workers: `workers/outbox-dispatcher.ts` runs the dispatcher loop + timers (purge). The alert scan hooks into this worker.
- Platform suites: `tests/platform/run-*.sh` (throwaway PG, bootstrap.sql, migrate deploy, node --test); register new suites in `scripts/run-platform-test.mjs`. CI does not run the Docker platform suites beyond schema/audit/transaction/files/scan — the ops suite is local-verified like its siblings.
- Zero new npm dependencies. Minimal comments; SPDX headers stay.

## 3. Metrics (checkbox 1)

Extend `app/api/v1/metrics/route.ts`: keep `service_up`; add on-scrape SQL aggregates (one GROUP BY per table), hand-rendered Prometheus text:

- `outbox_pending{destination}` — status='pending'
- `outbox_retry{destination}` — status='pending' AND attempt_count>0
- `outbox_dead{destination}` — status='dead_letter'
- `workflow_pending{state}` — one series per state in {requested, starting, pending, decision_pending}
- `workflow_failed{halt_reason}` — state='halted', grouped by halt_reason
- `outbox_oldest_pending_age_seconds` — max(now − created_at) over outbox rows in pending/leased, 0 when none
- `workflow_oldest_pending_age_seconds` — max(now − created_at) over approval rows in the pending state set, 0 when none

Rules: never use message/process IDs as labels; no payload or error text in metric output; the state→metric mapping above is written into the evidence file verbatim. The route's existing unauthenticated posture is unchanged (aggregate counts only, no IDs — same posture as the health endpoints; recorded in the evidence, not redesigned in T07).

## 4. Alert scan (checkboxes 1+3)

New `platform/observability/alerts.ts`:

- `scanStuckWork(db, logger, thresholds)` — pure query + emit; returns the alert objects (for tests). Injectable logger (capturable in tests).
- Emits one structured line per incident: event `ops.alert.stuck`, fields: kind (`outbox_dead` | `workflow_halted` | `workflow_starting_stuck` | `workflow_decision_stuck` | `outbox_oldest_pending`), messageId or approvalRequestId/processId, state, ageSeconds, errorCode/haltReason where applicable. Allowlisted fields only — never payloads, headers, credentials.
- Also emits `ops.scan.completed` once per scan with the incident count (a missing completion line means the scan itself is dead — the runbook says to watch for it).
- Thresholds are named constants in this module only; the runbook quotes them:
  - any dead_letter row → alert (immediate)
  - any halted approval → alert (immediate)
  - approval in `starting` with age > 300s → alert (starter completes in seconds; 300s is a generous multiple of the 5s reconciler cadence)
  - approval in `decision_pending` with age > 900s → alert (900s = 180 missed reconciler cycles — unambiguously stuck)
  - oldest outbox pending age > 900s → alert (dispatcher backoff caps at 300s; a row pending >900s has burned multiple full cycles)
- Repetition is by design: one line per incident per scan while the incident persists (alerts are state, not events). No dedup state.
- Wiring: `workers/outbox-dispatcher.ts` runs the scan on a 60s timer alongside the existing loops. Scan failures must not kill the dispatcher loop (catch + log `ops.scan.failed`).

## 5. Admin retries API (checkbox 2)

Use case: `platform/operations/retry-dead-letter.ts`. Routes: `app/api/v1/admin/retries/route.ts` (GET + POST in one route file, following the repo's route conventions).

- **Auth (both methods):** resolve session → active membership → permission via `platform/access/policy.ts`. Unauthenticated → 401. Authenticated without the operations-retry permission (e.g. staff) → 403, BEFORE any data access or mutation.
- **GET** (the spec's "Admin xem"): returns
  - `deadLetters`: id, eventType, destination, aggregateId, attemptCount, lastErrorCode, correlationId, ageSeconds — payload NEVER included.
  - `haltedApprovals` (view-only, no retry action exists for them): id, documentId, haltReason, flowableProcessId, ageSeconds.
- **POST** body: `{ "messageId": "<uuid>" }` ONLY. Any additional field (payload, status, etc.) → 400. This makes payload editing impossible by construction; no mark-delivered route exists anywhere.
- **Use case, ONE transaction:** read the row; missing → 404; status ≠ dead_letter → 409 with the current status, no audit row; status = dead_letter → call `retryDeadLetter(tx, id)`, then insert the audit record via `platform/audit/` (actor sub, action `outbox.dead_letter.retried`, messageId, correlationId, previous lastErrorCode) in the SAME transaction → 202 `{ status: "pending", auditId }`. A repeat POST after a successful retry hits the 409 path (row now pending) — the CAS in the primitive is the idempotency story; no Idempotency-Key machinery, no second audit row.

## 6. Runbook + evidence (checkbox 3)

- Runbook: `documents/phase-plan/evidence/p04-t07-runbook.md` — threshold table quoting §4 constants verbatim; per-alert-kind response steps; inspection SQL (reuse the T06 evidence stuck queries: dead-lettered rows, decision_pending >15min, halted rows, starting >30s); the permitted retry procedure (via the API only); forbidden actions (no manual UPDATE of outbox/approval rows, no mark-delivered, no payload edits, no Flowable DB surgery); halted-approval diagnosis path (reconciler logs incl. `workflow.reconcile.orphan_engine_process` for engine-side orphans); known limitations (alerts repeat per scan while an incident persists; the scan dies with the worker — watch for missing `ops.scan.completed`; engine-side checks deferred to G04/P12; /metrics posture note).
- Evidence: `documents/phase-plan/evidence/p04-t07.md` — claims ledger for the 3 checkboxes; the state→metric mapping; the seed SQL used by the suite; a REAL sample of /metrics output and a REAL sample alert line captured from the suite run (not hand-invented); the leakage-test statement.

## 7. Integration suite

`tests/platform/ops.integration.test.ts` + `tests/platform/run-ops.sh` (sibling throwaway-PG pattern), registered in `scripts/run-platform-test.mjs` as `ops` + npm script `test:platform:ops`.

Seeds: admin + staff memberships (following the repo's membership seed shapes); one dead_letter outbox row (destination `workflow`) whose payload AND last_error_code contain a secret-like sentinel string; one approval_request in decision_pending backdated 20 minutes with a flowable_process_id; one halted approval.

Assertions:
1. Metrics handler output contains `outbox_dead{destination="workflow"} 1`, `workflow_pending{state="decision_pending"} 1`, `workflow_failed{halt_reason=...} 1`, and both age gauges > 0.
2. Scan output contains an `ops.alert.stuck` line with the dead message's ID and one with the stuck approval's ID/processId; `ops.scan.completed` present.
3. Leakage: the sentinel string appears in NONE of: metrics output, GET response, alert lines, audit records.
4. Admin GET → 200 with the dead letter listed, no payload field anywhere; staff GET → 403.
5. Admin POST retry → 202; row is pending; exactly ONE audit row with the right actor, messageId, correlationId.
6. Repeat POST → 409; still exactly one audit row.
7. Staff POST → 403; row unchanged; zero new audit rows.
8. POST with an extra `payload` field → 400; row unchanged.
9. POST for a nonexistent messageId → 404.

The Next route handlers are invoked directly with fabricated request/session context (sibling suites do not boot Next). Recorded honestly in evidence: the live Keycloak→membership path is exercised by the G04 smoke, not this suite.

## 8. Commits (logical, in order)

1. `feat(p04-t07): queue and workflow metrics in /metrics`
2. `feat(p04-t07): stuck-work alert scan wired into the outbox worker`
3. `feat(p04-t07): permissioned admin retry use case`
4. `feat(p04-t07): admin retries API (list + retry)`
5. `test(p04-t07): ops integration suite`
6. `docs(p04-t07): runbook, evidence and tick T07 checkboxes`

## 9. Verification (Milo, independent)

npm test + typecheck + lint; run `tests/platform/run-ops.sh` live; re-check the metrics/GET outputs against the evidence samples; merge --no-ff into phase-04 per the standing merge law, push both branches, keep the task branch, watch CI.

## 10. Out of scope (explicit)

No Prometheus/Grafana/Alertmanager, no notification channels, no dashboard/admin UI, no counters or metrics table, no tracing, no new worker process, no dispatcher backoff/policy changes, no halted-approval resolution API (visibility + runbook only), no engine-side orphan metrics (reconciler log + deferral), no lifecycle-event emission (still P08/P09), no changes to the /metrics auth posture.
