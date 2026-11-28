<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# SRS — Commercial sales order

**Status:** Accepted with ADR 0019 — **2026-11-28**  
**BRD:** [`BRD-sales-order.md`](./BRD-sales-order.md)  
**Schema:** [`database-schema-v1.md`](../phase-plan/database-schema-v1.md) § Sales

## 1. Identity mapping (BRD-Trace)

| BRD-Trace concept | Nexora mapping |
| --- | --- |
| `invoice_id` | `sales.sales_order.id` |
| `invoice_item_id` | `sales.sales_order_line_lot.id` |
| `invoice_trace_tokens` | `sales.order_trace_token` |
| `public_trace_token` | Raw URL-safe token (returned once); DB stores `token_hash` |
| QR URL | `{PUBLIC_BASE_URL}/trace/{token}` (`qr_path` = `/trace/{token}`) |
| Lot ID | `catalog.batch.id` via `sales_order_line_lot.batch_id` |

Reserved for follow-on: `lot_incidents.invoice_item_id` → `sales_order_line_lot.id` (FK not created in this slice).

## 2. Status machine

`draft` → `paid` (checkout money) → `fulfilled` (after GI confirm + token mint) | `cancelled` from draft/paid before fulfill.

## 3. Checkout sequence

1. Snapshot retail (default price list) onto lines; warehouse from seller membership / picker.
2. FEFO allocate into `sales_order_line_lot`.
3. Create+confirm sale-purpose GI (POS fast-path; ADR 0018 §3).
4. Optional `sale_record` link.
5. Status `fulfilled`; mint `order_trace_token` + `snapshot_json` if ≥1 line_lot.
6. Response: `{ orderId, orderNumber, publicTraceToken, qrUrl }` (raw token once; idempotent replay via idempotency store).

## 4. Snapshot JSON allowlist

- `orderNumber`, `soldAt`, `orgDisplayName`
- `lines[]`: `{ invoiceItemId, productName, quantity, uomName, batchPublicCode, originSummary?, expiresOn? }`
- Omit: unit_price, totals, payment, COGS, warehouse ids, customer PII, other orders

## 5. APIs (v1)

| Method | Path | Policy |
| --- | --- | --- |
| GET/POST | `/api/v1/orders` | `sales:order:read` / `create` |
| GET | `/api/v1/orders/{id}` | `sales:order:read` |
| POST | `/api/v1/orders/{id}/checkout` | `sales:order:checkout` + Idempotency-Key |
| POST | `/api/v1/orders/{id}/cancel` | `sales:order:cancel` |
| POST | `/api/v1/orders/{id}/trace/reissue` | `sales:order:trace:revoke` |

Authenticated order detail may include `qrUrl` only when raw token is available from the last mint response store or after staff reissue.

## 6. Deferred

Public portal `GET /trace/{token}`, incident forms, quarantine automation — schema + mint + QR delivery only in this slice.
