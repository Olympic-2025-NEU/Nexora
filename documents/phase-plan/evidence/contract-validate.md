# P00-T05 — Contract validation evidence

**Date:** 2026-11-17
**Branch:** `chore/p00-audit-remediation`
**Command:** `npm run test:contracts`

```text
OpenAPI in sync (70 paths)
contracts/openapi/nexora-v1.yaml: validated by Redocly
openapi: PASS (70 paths, 87 operations, 30 request fixture pairs)
events: PASS (4 core pairs, 7 domain pairs, 7 federation valid, 9 negative, 3 retry/hash vectors)
validate-contracts: OK (static contract checks; no runtime API claim)
```

## What was checked

- `scripts/generate-openapi.mjs --check` detects generated YAML drift; Redocly checks OpenAPI 3.0.3 structure and references. The route matrix freezes all 87 operations, primary success status, public/OIDC/M2M auth, role, scope, 401/403 and selected concurrency/idempotency headers.
- Ajv checks 30 valid/invalid request-body pairs, four core-record payload pairs and seven trading/workflow outbox pairs. OpenAPI response shapes are declared and structurally checked; no running API response is claimed.
- Federation fixtures cover transfer A→B, partial and zero-actual receiving, B→C, downstream impact and B→A relay. Negative fixtures cover unsupported version, missing evidence, wrong issuer/recipient, over-receipt, invalid quantity, duplicate JSON key and private URL leakage. Decimal totals use integer milliscale arithmetic. RFC 8785 JCS SHA-256 hashes and same/different-hash retries are frozen in `contracts/events/fixtures/manifest-v1.json`.
- Stock transfer and sale responses have zero movement IDs; technical federation ACK has no receiving quantity; public passport schema excludes private stock, buyer and credential fields.

## Boundary and follow-up

This is a **static design contract**. P01+ must test actual route handlers against these schemas and status codes, authorization/scope, transaction rollback, concurrency and idempotency. P09 must run two-instance consumer-driven tests including audience/scope, offline delivery and replay. Do not close runtime ACs from this evidence alone. Contract changes require updating the Markdown blueprint, generator/schema, fixtures and locked route matrix together.
