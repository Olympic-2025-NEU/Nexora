# P04-T07 — Dead-letter and stuck-work runbook

The outbox worker scans every 60 seconds. Inspect structured `ops.alert.stuck` lines by `kind`, `messageId`, `approvalRequestId`, and `processId`. Each scan emits `ops.scan.completed` with `incidentCount`; investigate the worker if that line stops. A failed scan emits `ops.scan.failed` and does not stop dispatch.

| Alert kind | Trigger (constants in `platform/observability/alerts.ts`) | Response |
| --- | --- | --- |
| `outbox_dead` | Any `dead_letter` row: immediate | Inspect the admin list, last error code, destination, and downstream availability. Fix the underlying failure before retrying through the API. |
| `workflow_halted` | Any halted approval: immediate | Inspect the local state and reconciler logs; identify engine history/binding mismatch. No approval retry action exists. |
| `workflow_starting_stuck` | `starting` age > 300 seconds | Inspect the starter/Flowable logs and process instance by business key. Check for duplicate process or lost start response. |
| `workflow_decision_stuck` | `decision_pending` age > 900 seconds | Inspect the decision outbox, task/history and reconciler logs. Never infer approval from elapsed time. |
| `outbox_oldest_pending` | Oldest pending/leased outbox age > 900 seconds | Check worker health, leases, database readiness and destination; inspect pending rows before retry. |

Alerts repeat once per incident per scan until resolved; do not treat repeated lines as new incidents. A missing `ops.scan.completed` indicates the scan or worker may have stopped. The scan dies with the worker. Monitor the worker process independently.

## Inspect without changing state

```sql
SELECT id, destination, event_type, last_error_code, correlation_id, created_at
FROM platform.outbox_message WHERE status = 'dead_letter' ORDER BY created_at;

SELECT id, document_id, updated_at, version FROM platform.approval_request
WHERE state = 'starting' AND flowable_process_id IS NULL AND updated_at < now() - interval '30 seconds';

SELECT id, flowable_process_id, flowable_task_id, decision_requested_at
FROM platform.approval_request
WHERE state = 'decision_pending' AND decision_requested_at < now() - interval '15 minutes';

SELECT a.id, a.flowable_process_id, o.id AS outbox_id, o.last_error_code
FROM platform.approval_request a JOIN platform.outbox_message o
  ON o.aggregate_type = 'approval_request' AND o.aggregate_id = a.id
WHERE a.state = 'decision_pending' AND o.event_type = 'workflow.approval.decision_requested.v1'
  AND o.status = 'dead_letter';

SELECT id, halt_reason, flowable_process_id, updated_at FROM platform.approval_request
WHERE state = 'halted' ORDER BY updated_at DESC;
```

The 30-second `starting` query is an early diagnostic from T06, not the 300-second alert threshold. For halted approvals, compare the local process ID with Flowable history and `workflow.reconcile.*` lines. The reconciler reports engine-side orphans as `workflow.reconcile.orphan_engine_process`; local-table metrics cannot detect those orphans. Engine-side checks are deferred to G04/P12.

## Authorized retry

1. Use an active Administrator bearer token. Call `GET /api/v1/admin/retries` to identify the dead-letter message and its correlation ID. Staff receives 403.
2. Fix the downstream failure. Call `POST /api/v1/admin/retries` with exactly `{ "messageId": "<uuid>" }`.
3. Expect 202 with `status: "pending"` and `auditId`; verify the audit record and subsequent dispatch. A repeated request returns 409 and creates no second audit record. A missing message returns 404.

Never manually UPDATE outbox or approval rows. Never mark a message delivered without a verified delivery. Never edit an emitted payload or operate directly on the Flowable database. Halted approvals are view-only; diagnose them against engine history and reconciler logs.

`/api/v1/metrics` remains unauthenticated with aggregate-only output (no IDs); its deployment access posture is unchanged in T07. Keep it on the internal gateway/network as described in `documents/phase-plan/security.md`.
