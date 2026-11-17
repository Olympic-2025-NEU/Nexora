# Nexora contract v1 — design locked, runtime pending

The versioned files in this directory are the **Phase 00 target contract** for later implementation. They do not claim that all routes, DB tables, Keycloak policies or federation workers currently run.

| Artifact | Scope | Human blueprint |
| --- | --- | --- |
| `openapi/nexora-v1.yaml` | 70 paths / 87 operations, typed request/response schemas, roles, scope, headers and error responses | `documents/phase-plan/api-payloads-v1.md` |
| `openapi/fixtures/route-matrix-v1.json` | Locked operation/auth/success inventory | `api-payloads-v1.md` |
| `openapi/fixtures/request-cases-v1.json` | 30 valid/invalid request body pairs reused across routes | `api-payloads-v1.md` |
| `events/envelope-v1.schema.json` | Federation envelope, event-specific fields and bounds | `documents/phase-plan/event-payloads-v1.md` |
| `events/*-v1.schema.json` | Five trading and two workflow outbox payloads | `event-payloads-v1.md`, `workflow-spec-v1.md` |
| `events/fixtures/` | A→B→C, partial/zero receiving, downstream relay, invalid payloads and JCS retry vectors | `demo-fixtures.md` |
| `core-records/*.schema.json` | Four core-data payload kinds | `core-record-payloads-v1.md` |

`scripts/generate-openapi.mjs` is the reproducible OpenAPI source. It reads the event/core JSON schemas for shared shapes. To change v1, update its route/schema definitions, the relevant Markdown blueprint and the fixtures in one PR, then run:

```bash
npm run generate:openapi
node scripts/check-spdx.mjs --write-inventory
node scripts/check-licenses.mjs --write-inventory
npm run test:contracts
```

`npm run test:contracts` checks generated-file drift, Redocly OpenAPI structure, every route's auth/success/headers, request fixtures, core/domain/federation JSON Schemas, A→B→C provenance, recipient/issuer and quantity invariants, duplicate JSON keys, and JCS SHA-256/retry vectors in Node plus an independent Python check for the envelope's ASCII-key/integer/string subset. A future route implementation must add runtime API tests for actual 401/403/409 behavior, transaction rollback and concurrency in its owning phase. Static contract checks cannot substitute for those tests.
