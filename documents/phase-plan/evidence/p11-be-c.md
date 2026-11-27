# P11-BE-C — Lot history + public evidence ownership

Date: 2026-11-27. Branch: `phase11/p11-be-c-history-evidence`.

## Changes

- Implemented `GET /api/v1/lots/{id}/history` returning OpenAPI `TraceHistory` (batch projection + paginated local trace events with `gap` when not `local_verified`). Policy: `trace:read`.
- Confirmed `GET /api/v1/public/evidence/{token}` is owned by **Core Data** (`services/core-data/files/public-evidence.mjs`) and routed by APISIX (`public-evidence-v1` → `core-data:8080`). Passport QR issuance already mints 60s capability URLs to this path. No ERP duplicate route.

## Verification

- Route file: `app/api/v1/lots/[id]/history/route.ts` + `contexts/traceability/application/history-http.ts`.
- Core public evidence unit test: `services/core-data/files/public-evidence.test.mjs` (fail-closed unknown/corrupt).
- Privacy: public passport payload remains allowlisted via `qr-token.ts`; evidence stream rechecks token, policy, clean scan, and checksum.
