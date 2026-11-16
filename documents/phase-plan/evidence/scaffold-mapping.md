# P00-T06 — Scaffold mapping (legacy → target)

**Rule:** Do **not** delete legacy code until imports are proven unused and target contexts exist. This file is a plan map only.

| Current path | Target | Action | Notes / Blocker |
| --- | --- | --- | --- |
| `contexts/sales/**` | `contexts/trading/**` (SaleRecord / issue purpose sale) | Delete after target exists | Not Ch6 module; no shared imports assumed — verify before delete |
| `contexts/finance/**` | — (out of MVP) | Delete | Explicitly out of scope |
| `contexts/procurement/**` | — / partial → trading GoodsReceipt patterns | Delete | Not Ch6 procurement module |
| `contexts/master-data/domain/item.ts` | `contexts/catalog/` Product | Move concepts | Rebuild under catalog; do not copy Laravel-like models blindly |
| `contexts/master-data/domain/partner.ts` | `contexts/system/` Partner | Move concepts | Partner + connection under M01 |
| `contexts/master-data/**` | — | Delete after move | — |
| `contexts/inventory/domain/reservation.ts` | `contexts/inventory/` balance/movement | Keep then redesign | Reservation guard may inform concurrency; stock SoT is balance+movement |
| `platform/tenancy/tenant.ts` | Single-org SoT (no SaaS tenant_id) | Deprecate / remove | Conflicts `SOURCE_OF_TRUTH`; replace with org/instance helpers under `platform/identity` or `system` |
| `platform/*` ports (audit, outbox, workflow, files, persistence, access, identity) | Same paths + real adapters | Keep | Implement Prisma TX, adapters after G00 |
| `app/api/v1/health/route.ts` | `health/live` + `health/ready` | Replace | Static ok ≠ readiness contract |
| `db/migrations/0001_platform.sql` (0 byte) | `prisma/migrations/` | Replace | D03; P01 |
| Missing `contexts/system\|catalog\|trading\|traceability\|federation` | Create empty context shells | Create | After G00 / with first module PR |
| Missing `services/core-data/`, `apps/dx-lab/`, `workers/` | Per D15 / FOLDER_STRUCTURE | Create | Skeleton only when ADR spike ready |

## Suggested order

1. Stop new code in legacy folders.  
2. Add target contexts as modules are implemented (P05+).  
3. Delete legacy folders in a dedicated PR with import grep evidence.  
4. Remove `platform/tenancy` once org/instance helper lands.
