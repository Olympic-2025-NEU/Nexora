# ADR 0016 — UI surface partitioning by bounded context

- **Status:** Accepted
- **Date:** 2026-11-22
- **Blocks:** ERP UI IA (post-G06 polish), P07–P11 route maps, gateway public UI routes
- **Related:** D15 (headless vs tier-2), D10 (DX-Lab H-P-D-I), M01–M04 module plans

## Context

Early M01/M02 admin screens were mounted under a single `/admin/*` tree for delivery speed. That conflates **system administration** (organization, membership) with **catalog** and **inventory** workspaces. Staff then see an “Admin” surface for product work, which weakens RBAC-oriented navigation and drifts from bounded-context modularity.

## Decision

**One shared ERP AppShell** for day-to-day work. URL prefixes still follow bounded contexts (not a second “admin site”):

| Area | Canonical prefix | Owns |
| --- | --- | --- |
| ERP workspace (primary nav) | `/catalog/*`, `/inventory/*`, `/partners/*`, later `/trading/*`, `/trace/*` | Products, batches, warehouses, stock RO, partners; trading/trace when shipped |
| System administration | `/admin/*` | Organization + members only. **Not** a separate product shell — same AppShell; entry via **user menu** for `administrator` |

**Rules:**

1. Primary header nav = ERP modules (role-filtered). System admin is **not** mixed into that nav as a second site switcher.
2. Administrator sees **System administration** in the user (and mobile) menu → `/admin`.
3. Hiding a nav item is UX only. Authorization remains server-side (`platform/access/policy.ts` + API 403).
4. Legacy paths `/admin/products|batches|warehouses|inventory|partners` **redirect** to canonical prefixes.
5. Ops APIs such as `/api/v1/admin/retries` stay under the API admin namespace.
6. DX-Lab (P11) remains a separate tier-2 app (D10/D15).
7. Catalog masters (UOM, category tree, price lists) and variant-centric SKU: requirements in BRD/SRS product-catalog; schema in **[0017](./0017-catalog-variant-uom-price.md)** + pack `evidence/p065-schema-design.md` before DDL/UI CRUD. Trading customers / full POS remain out of scope without a separate ADR.

## Consequences

- Phase plans use canonical prefixes; G05/G06 remain closed for API/DB.
- Gateway exposes HTML GET for `/catalog*`, `/inventory*`, `/partners*`, `/admin*`.
- UX: one ERP chrome; admin is a destination, not a parallel workspace switcher.
- `/catalog/products` index is table-first; categories / uom / pricing routes are first-class once APIs exist (decision-log D17).

## Compliance

Requirements detail: `documents/requirements/SRS-UI-surfaces.md`, `documents/requirements/BRD.md`, `documents/requirements/BRD-product-catalog.md`, `documents/requirements/SRS-product-catalog.md`.
