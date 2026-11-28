# P11-BE-A — Approvals version/evidence + batch search

Date: 2026-11-27. Branch: `phase11/p11-be-a-approvals-batches`. Supports P11-T04 BatchPicker and approval inbox.

## Changes

- `ApprovalTask` now includes `approvalVersion` and `evidenceFileIds` (active TraceEvidence `attachmentId`s for the document).
- `POST /api/v1/approvals/{id}/decisions` requires `If-Match` / body `version`; mismatches return 409 `VERSION_CONFLICT`.
- `GET /api/v1/batches` accepts `q` (localCode / issuer contains; UUID equality on id/originLot/product/variant).
- OpenAPI, fixtures, ERP approvals client, and `journey-p07-t07.mjs` updated for versioned decide.

## Verification

- `node scripts/generate-openapi.mjs` + `validate-contracts.mjs`: pass.
- `npm run generate:dxlab-api`: pass.
- Live AC-12 journey (`deploy/scripts/journey-p07-t07.mjs`) requires seeded creator/approver + worker; run when stack has Flowable worker up. Contract and unit paths above are closed for BE-A.
