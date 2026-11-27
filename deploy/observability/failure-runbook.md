# Failure injection runbook (P12-T07)

Demo Compose only. Alerts come from `platform/observability/alerts.ts` (worker scan) and Prometheus rules in `deploy/observability/rules.yml`.

## Service down

1. `docker compose -p nexora-a --profile apps stop worker` (or `flowable`).
2. Expect: worker `/metrics` unreachable → Prometheus `ServiceDown`; ERP metrics still scrape if erp up.
3. Recover: `docker compose -p nexora-a --profile apps start worker`.
4. Confirm: `service_up{service="worker"} 1` and outbox drain resumes.

## Kill worker (projection / archive lag)

1. Stop worker mid-traffic.
2. Confirm OLTP confirm still succeeds (archive/projector async).
3. Expect rising `trace_projection_lag_seconds` / `archive_export_lag_seconds` after restart backlog.
4. Restart worker; lag returns toward 0 without duplicate archive partitions.

## Outbox backlog

1. Stop worker while generating confirmations.
2. Expect `outbox_oldest_pending_age_seconds` growth; after threshold, `scanStuckWork` emits `outbox_oldest_pending`.
3. Restart worker; age falls.

## Flowable unavailable

1. Stop Flowable container.
2. Approvals that need engine start may halt → `workflow_failed` / stuck starting alerts after threshold.
3. Restart Flowable; reconciler/worker resume.

Do not claim production SRE coverage from this demo drill.
