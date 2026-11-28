# BRD — Nexora business requirements (MVP appendix)

**Status:** Living appendix (aligned to ADR 0016, scope-v1, M01–M04)  
**Audience:** Product / engineering  
**Non-goals for this document:** Full ERP/POS/finance SaaS parity  
**Catalog upgrade:** [`BRD-product-catalog.md`](./BRD-product-catalog.md) + [`SRS-product-catalog.md`](./SRS-product-catalog.md) (requirements accepted 2026-11-22; implement only after schema ADR)  
**Partner link (self-host inter-enterprise):** [`BRD-partner-link.md`](./BRD-partner-link.md)

## 1. Business problem

Enterprises in a supply chain need a **headless DX-OS core** plus a modular business app to manage organization membership, federated partners, product lots, warehouses, stock visibility, trading documents, and traceability — with open-source compliance and instance-isolated data.

Each enterprise **self-hosts** its Nexora instance (own domain / VPS / server). Two Nexora enterprises connect by **opt-in partner links** that push business notices to a fixed partner system address — see [`BRD-partner-link.md`](./BRD-partner-link.md). On an inter-enterprise shipment, the shipper and receiver are effectively **supplier and customer for that document direction**; the product model keeps a **single Partner** entity and derives those roles from the trading document — not fixed supplier/customer flags on Partner. Product UI must use commercial language, not transport jargon.

## 2. Actors

| Actor | Intent |
| --- | --- |
| Administrator | Configure organization, invite/disable members, assign warehouse scope, manage partner connections |
| Staff | Maintain catalog/lots/warehouses; create trading drafts; read inventory in scope |
| Approver | Approve goods-issue (and similar) workflows; not substitute for confirm |
| Viewer | Read-only catalog/inventory/trace where policy allows |
| Partner (M2M) | Federation events/ACK via gateway; not browser admin |
| Public | Passport/QR projection only |

## 3. MVP capabilities (business)

1. Single-org instance with Keycloak identity and gateway Bearer API.
2. Organization profile + membership lifecycle (admin-invite; fixed roles).
3. Partner registry + two-way link setup (system ID trust; authorization secret as references only; in-app connection guide). Unified Partner model: one registry for linked Nexora enterprises; supplier/customer meaning is document-direction only ([`BRD-partner-link.md`](./BRD-partner-link.md) §1.1).
4. Product catalog: P06 delivered a minimal product+batch model; **target upgrade** is variant-centric (SKU/barcode on variant), category tree, UOM master, price lists — see [`BRD-product-catalog.md`](./BRD-product-catalog.md).
5. Warehouses + read-only stock balances/movements until trading confirms stock (stock will neo **variant** after catalog ADR).
6. Later: trading documents (P07), trace/passport (P08), federation inbox (P09), AI draft-only (P10), DX-Lab H-P-D-I (P11).

## 4. UI business rules (surfaces)

- **One ERP shell** for catalog, inventory, partners (and later trading/trace). URL prefixes stay modular; there is **no** separate “admin site” switcher.
- **System Admin** (`/admin`) covers organization and members only; administrators open it from the **user menu**.
- Nav filtering is not security; APIs enforce policy.
- No user-facing phase/module codes (M0x/P0x) in product chrome.
- `/catalog/products` lands on a **row index** (see product-catalog SRS).

## 5. Explicit non-goals (MVP)

- Full POS checkout, complex promotions, AR/AP, multi-currency sophistication beyond one currency per price list.
- Dynamic RBAC permission editor (inventing arbitrary permissions in UI). Fixed **job-role codes** with **multi-role** membership are in scope per [ADR 0018](../adr/0018-rbac-multi-job-roles.md).
- Separate CRM customer/supplier masters (or fixed supplier/customer flags on `system.Partner`) for Nexora-to-Nexora trade — use one Partner + document-direction roles instead ([`BRD-partner-link.md`](./BRD-partner-link.md) §1.1). Non-Nexora trading counterparties as Partner remain out of MVP.
- Manual stock PATCH outside Inventory port / trading confirm.
- Multi-category n–n on one product; BOM / manufacturing.

### 5.1 Superseded non-goals (now in product-catalog BRD/SRS — pending ADR)

The following were deferred in early MVP text; they are **in scope as requirements** in [`BRD-product-catalog.md`](./BRD-product-catalog.md) (implementation gated on ADR, not this appendix alone):

- UOM master + per-variant conversion factors (system default **CÁI**).
- Product category tree (`parent_id`).
- Commercial price lists (`price_list` / `price_list_item`) distinct from COGS.
- SKU/barcode on **product_variant** (not on product).

## 6. Success criteria (business)

- A/B/C instances can run the vertical demo in `scope-v1` / acceptance matrix without sharing a database.
- Staff can work catalog/inventory without entering a misleading “Admin products” area.
- Administrator can manage members without catalog clutter.
- Gates G05–G07 (and later) remain meaningful: API + DB + auth + **surface-appropriate** UI tối thiểu.
- Catalog upgrade docs are complete enough for a schema ADR without re-litigating business rules.
- Partner link docs/UI state the unified Partner model (document-direction supplier/customer) without separate CRM masters for Nexora-to-Nexora trade.
