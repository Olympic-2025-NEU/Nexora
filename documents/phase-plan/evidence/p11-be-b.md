# P11-BE-B — AI OpenAPI aligned to runtime

Date: 2026-11-27. Branch: `phase11/p11-be-b-ai-contract`.

## Changes

- Replaced contract paths `POST /ai/drafts` and `GET /ai/tool-calls/{id}` with runtime:
  - `POST /api/v1/ai/chat`
  - `POST /api/v1/ai/draft`
  - `POST /api/v1/ai/draft/create`
  - `POST /api/v1/ai/risk/feedback`
- Updated request/response schemas and fixtures; regenerated DX-Lab typed client including AI shapes.
- Tool-call audit remains in `platform.audit_log` (no public tool-calls GET).

## Verification

- `node scripts/generate-openapi.mjs --check` + Redocly + `validate-contracts.mjs`: pass (91 paths / 118 ops).
- `npm run generate:dxlab-api` / `check:dxlab-api`: pass.
- Existing AI suites (`test:ai:golden`, `test:ai:draft`, `test:ai:adversarial`, `test:ai:security`) remain the behavioral proof; contract now matches those routes.
