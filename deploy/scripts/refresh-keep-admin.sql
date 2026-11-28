-- SPDX-License-Identifier: AGPL-3.0-only
-- Refresh business data; keep system.organization + membership (+ roles).
-- Run as migrator against nexora DB.

BEGIN;

-- Sales commercial
TRUNCATE TABLE
  sales.order_trace_token,
  sales.sales_order_line_lot,
  sales.sales_order_line,
  sales.sales_order
RESTART IDENTITY CASCADE;

-- Trading documents & details
TRUNCATE TABLE
  trading.issue_source_allocation,
  federation.business_receipt_line,
  federation.business_receipt,
  federation.partner_ack,
  trading.receipt_detail,
  trading.receiving_detail,
  trading.transfer_detail,
  trading.sale_detail,
  trading.document_line,
  trading.document,
  platform.approval_request
RESTART IDENTITY CASCADE;

-- Inventory balances / movements
TRUNCATE TABLE
  inventory.stock_movement,
  inventory.stock_balance
RESTART IDENTITY CASCADE;

-- Trace / passport projections tied to lots (best-effort)
TRUNCATE TABLE
  traceability.trace_evidence_access,
  traceability.trace_evidence,
  traceability.trace_link,
  traceability.trace_event,
  traceability.quality_issue,
  traceability.qr_token,
  traceability.passport_policy,
  traceability.passport_projection
RESTART IDENTITY CASCADE;

-- Federation inbox / outbox / identity
TRUNCATE TABLE
  federation.federated_trace_summary,
  federation.identity_mapping,
  federation.inbox_message,
  federation.delivery_attempt,
  platform.outbox_message,
  platform.inbound_message,
  platform.idempotency_record
RESTART IDENTITY CASCADE;

-- Catalog operational data (keep system UOM / default category / default price list headers)
TRUNCATE TABLE
  catalog.product_image,
  catalog.variant_code,
  catalog.product_variant_uom,
  catalog.price_list_item,
  catalog.batch,
  catalog.product_variant,
  catalog.product,
  catalog.local_supplier
RESTART IDENTITY CASCADE;

-- Partners (Nexora links) — rebuild later if needed
TRUNCATE TABLE
  system.partner_connection,
  system.partner
RESTART IDENTITY CASCADE;

-- Warehouses: clear membership links then warehouses (admin will get reassigned after seed)
TRUNCATE TABLE
  system.membership_warehouse
RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  inventory.warehouse
RESTART IDENTITY CASCADE;

COMMIT;
