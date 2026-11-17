# D06 — Workflow = Flowable goods-issue-approval

- **Status:** Accepted (spike evidence linked 2026-11-17)
- **Blocks:** P04/P07
- **Date:** 2026-11-16
- **Decision owners:** Dev (promoted from phase-00 spike)
- **Baseline source:** `documents/phase-plan/implementation-baseline.md`, `decision-log.md`

## Context

Nexora needs a single agreed default before P01 runtime work. This ADR records the baseline choice so agents do not invent alternate stacks. It is **not** proof that the dependency is running in the repo.

## Decision

Flowable OSS REST + dedicated PostgreSQL. BPMN process goods-issue-approval applies to every GoodsIssue v1. Approver != creator. App owns document state; bridge/poller reconciles. No H2 or default demo passwords in release. Spec: workflow-spec-v1.md (BPMN XML deferred until spike).

## Pin fields (from spike)

| Field | Value |
| --- | --- |
| image / package version | Flowable 8 + PG17 (spike) |
| digest | see D06-workflow-engine.md |
| license | Apache-2.0 (Flowable OSS) |
| source URL | https://www.flowable.com/open-source |
| RAM (measured) | see D13 / infra README |
| Owner for spike | Dev |


## Consequences

- Implementation tasks must follow this decision until a superseding ADR.
- Contracts (`api-contracts`, `event-contracts`, `database-schema-v1`, `security`) stay aligned; change them in the same PR as any ADR revision.
- Spike for this ADR is recorded; G00 still needs human reviewers and remaining P00 checklist items.

## Contract impact

- See phase-plan docs linked from decision-log for this ID.
- Approval routes and workflow outbox payloads are now versioned under `contracts/`; the app bridge remains P04/P07 runtime work.

## Spike evidence

- [x] Deploy BPMN goods-issue-approval
- [x] Approve/reject ends
- [x] Tasks persist across restart
- [x] Default admin denied; P04 owns app bridge

**Evidence links:** ../phase-plan/evidence/spikes/infra/README.md + D06-workflow-engine.md
