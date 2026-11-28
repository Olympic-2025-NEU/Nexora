<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# ADR 0019 — Commercial sales order + POS stock + invoice QR token (D19)

- **Status:** Accepted
- **Date:** 2026-11-28
- **Blocks:** `sales` schema DDL, `/api/v1/orders`, POS checkout stock path, invoice `public_trace_token`
- **Related:** D14 (movement ownership), D06 (Flowable goods-issue), D16 (UI surfaces), D17 (variant/UOM/price), D18 (RBAC job roles), [BRD-Trace.md](../requirements/BRD-Trace.md), [BRD-sales-order.md](../requirements/BRD-sales-order.md), [SRS-sales-order.md](../requirements/SRS-sales-order.md)
- **Expands:** BRD.md / ADR 0016 POS non-goals that deferred commercial Order money model

## Context

G07 shipped money-free `trading.sale_record` linked 1:1 to a confirmed `goods_issue` with `issue_purpose=sale`. Stock leaves inventory only on GI confirm (D14). POS UI collected cart/payment locally but posted only create+confirm sale_record against a pre-linked issue — no commercial Order, no price snapshot, no automatic lot allocation, no customer-facing invoice QR.

BRD-Trace requires every fulfilled lot-managed sale invoice to mint a `public_trace_token` and QR URL for public provenance. Passport `traceability.qr_token` is lot-scoped and must not be overloaded for invoices.

## Decision

### 1. Commercial order lives in schema `sales`

- New Postgres schema **`sales`**, separate from money-free `trading.sale_record`.
- Tables: `sales_order`, `sales_order_line`, `sales_order_line_lot`, `order_trace_token`.
- Status: `draft | paid | fulfilled | cancelled`.
- Money on header + line snapshots (list price from `price_list_item`); **never** store COGS on the order.
- Optional links: `linked_issue_id`, `linked_sale_id` → `trading.document` for D14 continuity.

### 2. Stock debit remains D14 goods_issue

- Checkout allocates lots (FEFO), creates `goods_issue` `purpose=sale`, confirms it, then marks order `fulfilled`.
- Optional `sale_record` may still be created for trading/trace event continuity.
- Inventory port `adjustStock` is the only writer of stock movements.

### 3. POS sale-purpose GI Flowable exception

- Non-sale goods issues keep D06 Flowable: draft → submit → approve → confirm.
- **POS / sales-checkout fast-path** for `issue_purpose=sale` only: create draft GI, insert an `approval_request` already `approved` (no Flowable engine call; audit action `trading.document.pos_sale_fast_path`), transition document to `approved`, then confirm + adjust stock in the same transaction.
- Audit records the fast-path; partner_transfer / other purposes remain Flowable-gated.

### 4. Invoice trace token vs passport QrToken

- `sales.order_trace_token` = BRD `invoice_trace_tokens` (order-scoped).
- Store **`token_hash` only** (SHA-256); raw token returned once at mint / idempotent checkout response.
- `sales_order_line_lot.id` = BRD `invoice_item_id` (one product from multiple lots → multiple public rows).
- Mint when order becomes `fulfilled` and has ≥1 line_lot; no expiry (FR-01.2).
- `snapshot_json` is public-safe allowlist only (no prices, COGS, stock-on-hand, customer PII).
- Do **not** reuse `traceability.qr_token`.

### 5. FEFO ownership

- Sales context owns FEFO allocation at checkout: pick available, non-expired batches by earliest `expires_on` (nulls last), split across lots as needed.
- Trading GI lines receive the allocated `batch_id` / qty; caller no longer picks lots on POS.

### 6. Policy keys

Add: `sales:order:read|create|checkout|cancel|trace:revoke`. Staff/sales_clerk for create/checkout; readers for read; admin for revoke/reissue.

## Consequences

- `/orders` and `/pos` retarget commercial orders API; POS drops mandatory pre-linked issue picker.
- `/api/v1/sales-records` remains for lot-trace ops without money.
- Full Public Trace Portal + lot incidents are a follow-on slice; schema reserves `invoice_item_id` (= line_lot.id) for FKs.
- ADR 0006 remains authoritative for non-sale GI; this ADR documents the sale-purpose exception only.
