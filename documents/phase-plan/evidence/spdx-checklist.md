# P00-T04 — SPDX checklist (docs only)

**License project:** `AGPL-3.0-only` — full text in repo root `LICENSE`.  
**Rule:** Every authored source file needs `SPDX-License-Identifier: AGPL-3.0-only` (header comment). Third-party notices stay separate in `NOTICE` if required.

**This package does not modify source files.** Status below is inventory as of 2026-11-16.

| File | SPDX present? | Owner |
| --- | --- | --- |
| `app/api/v1/health/route.ts` | missing | Dev |
| `app/layout.tsx` | missing | Dev |
| `app/page.tsx` | missing | Dev |
| `components/shell/areas.ts` | missing | Dev |
| `composition/context-map.ts` | missing | Dev |
| `contexts/finance/domain/invoice.ts` | missing | Dev |
| `contexts/finance/index.ts` | missing | Dev |
| `contexts/inventory/domain/reservation.ts` | missing | Dev |
| `contexts/inventory/index.ts` | missing | Dev |
| `contexts/master-data/domain/item.ts` | missing | Dev |
| `contexts/master-data/domain/partner.ts` | missing | Dev |
| `contexts/master-data/index.ts` | missing | Dev |
| `contexts/procurement/domain/purchase-order.ts` | missing | Dev |
| `contexts/procurement/index.ts` | missing | Dev |
| `contexts/sales/application/ports.ts` | missing | Dev |
| `contexts/sales/domain/sales-order.ts` | missing | Dev |
| `contexts/sales/index.ts` | missing | Dev |
| `platform/access/scope.ts` | missing | Dev |
| `platform/audit/audit-recorder.ts` | missing | Dev |
| `platform/files/file-store.ts` | missing | Dev |
| `platform/http/pipeline.ts` | missing | Dev |
| `platform/identity/actor.ts` | missing | Dev |
| `platform/kernel/errors.ts` | missing | Dev |
| `platform/kernel/id.ts` | missing | Dev |
| `platform/outbox/message.ts` | missing | Dev |
| `platform/persistence/transaction.ts` | missing | Dev |
| `platform/tenancy/tenant.ts` | missing | Dev |
| `platform/workflow/process.ts` | missing | Dev |
| `platform/index.ts` | missing | Dev |
| `platform/modules.ts` | missing | Dev |
| `next.config.ts` | missing | Dev |

`next-env.d.ts` is generated — follow Next/tooling norms; do not treat as authored business source for SPDX sweep unless policy says otherwise.

## Done when

- [ ] Script or review confirms every authored source has SPDX  
- [ ] `NOTICE` created if third-party bundled assets require it  
- [ ] No secret files committed  
