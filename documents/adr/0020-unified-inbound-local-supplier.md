<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# ADR 0020 — Unified inbound UI + local supplier (≠ Partner)

- **Status:** Accepted
- **Date:** 2026-11-28
- **Blocks:** `catalog.local_supplier`, `trading.receipt_detail`, `/trading/inbound`, `/api/v1/local-suppliers`, `/api/v1/inbound`
- **Related:** ADR 0016 (UI surfaces), D14 (movement ownership), [BRD-partner-link.md](../requirements/BRD-partner-link.md), [SRS-UI-surfaces.md](../requirements/SRS-UI-surfaces.md)
- **Does not change:** Federation trust (D05), `system.partner` / `partner_connection`

## Context

Inbound stock today is split: weak internal `goods_receipt` (no supplier) vs federation `receiving_confirmation` (announcement-driven). Operators need one create/edit surface with two supply sources: **local retail suppliers** (user CRUD) and **Nexora-linked partners**. BRD forbids using `system.Partner` as a CRM master for non-Nexora counterparties.

## Decision

### 1. LocalSupplier is a separate master

- Table `catalog.local_supplier`: `code`, `display_name`, `status`, optional contact/note.
- No `issuer_instance_id`, no `partner_connection`, no federation events.
- Policies: `trading:local-supplier:read|manage` (inventory_clerk + admin).

### 2. Document types stay split under the hood

| UI sourceKind | Document type | Counterparty |
|---------------|---------------|--------------|
| `local` | `goods_receipt` | `trading.receipt_detail.local_supplier_id` (optional) |
| `nexora` | `receiving_confirmation` | Existing `source_issuer_instance_id` / transfer / inbox |

Stock effects and federation reply paths remain unchanged (D14 / receiving confirm).

### 3. Unified UI shell

- Nav **Nhập hàng** → `/trading/inbound` (list + shared form for create/edit).
- `/trading/suppliers` for LocalSupplier CRUD; quick-add from inbound form.
- `/partners` remains the Nexora link hub only.
- Legacy `/trading/receipts*` and `/trading/receivings*` redirect into inbound.

### 4. BFF list merge

- `GET /api/v1/inbound` merges receipt + receiving rows into a normalized list DTO (`sourceKind`, `counterpartyLabel`, …).
- Write paths continue to hit `/api/v1/receipts` or `/api/v1/receivings`.

## Consequences

- `batch.source_partner_id` stays federation-Partner-only; local provenance is on receipt header.
- POS / `customerPartnerId` does not reuse LocalSupplier in this slice.
- OpenAPI may lag; runtime routes are authoritative until contract pack is regenerated.
