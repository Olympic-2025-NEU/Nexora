# SRS — ERP UI surfaces (appendix)

**Status:** Canonical UI route requirements (ADR 0016)  
**Applies to:** Next.js ERP under `app/` (not DX-Lab `apps/dx-lab/`)  
**Catalog detail:** [`SRS-product-catalog.md`](./SRS-product-catalog.md)

## 1. Surfaces and routes

**Shell:** one shared ERP `AppShell` (header + primary nav). System admin is opened from the **user menu** (administrator only), not a second site / workspace switcher.

| ID | Area | Prefix | Required screens (MVP UI) |
| --- | --- | --- | --- |
| S-ERP | Primary nav | `/catalog`, `/inventory`, `/partners` | Products **index (table rows)**, product detail/variants; batches; warehouses; balances; unified partner connection hub |
| S-CAT | Catalog masters | `/catalog` | Categories tree; UOM master; price lists + items (per product-catalog SRS) |
| S-ADM | System admin (user-menu entry) | `/admin` | Hub (system only); Organization; Members (**index table** + invite/edit/assign-roles **modals**) |
| S-TRD | Trading | `/trading` | From P07; **inbound** unified at `/trading/inbound` (ADR 0020) |
| S-TRC | Trace | `/trace` | From P08 |

### Inbound / local suppliers (ADR 0020)

| Route | Requirement |
| --- | --- |
| `/trading/inbound` | Unified list: `sourceKind` local (`goods_receipt`) vs nexora (`receiving_confirmation`); filter by status / q |
| `/trading/inbound/new`, `/trading/inbound/[id]` | **Same form** create/edit: segmented source type; local → LocalSupplier + free lines; nexora → inbound notice + mapped lots |
| `/trading/suppliers` | CRUD **LocalSupplier** (retail / non-Nexora). Not `/partners`. |

**LocalSupplier ≠ Partner:** do not put non-Nexora vendors on `system.partner`. Partner hub stays federation-only.

### Catalog routes (requirements — implement with API)

| Route | Requirement |
| --- | --- |
| `/catalog/products` | Default **index table** (not empty create form): name, category, active, variant count, primary retail if available |
| `/catalog/products/new`, `/catalog/products/[id]` | Create / detail; manage variants, variant UOMs, prices |
| `/catalog/categories` | Category tree CRUD |
| `/catalog/uom` | UOM master (system default CÁI visible) |
| `/catalog/pricing` | Price lists (general vs coded) + items |

Until schema ADR + API ship, screens may show an honest empty/disabled state — **not** fake CRUD.

### Partner link routes (business language — see BRD-partner-link)

| Route | Requirement |
| --- | --- |
| `/partners` | **Unified connection hub**: partner index table; create/edit partner via **modal**; link setup (system address → two-way authorization) via **modal** + Check link; always-visible **How to connect** guide (must state: one Partner; supplier/customer = ship/receive direction); embedded **partner link monitoring** (admin-only, hides on 403) — commercial wording only |

Default notice URL derived from partner system address: `https://{domain}/api/v1/federation/events` (admin may override when partner provides another URL). Secrets remain write-only references (`env:` / `secret:`).

**Partner vs supplier/customer (UI rule):** Do **not** show fixed “Supplier” / “Customer” master roles on Partner. On trading documents (P07+), label counterparties as **receiving partner** / **sending partner** (VI: Đối tác nhận / Đối tác gửi). See [`BRD-partner-link.md`](./BRD-partner-link.md) §1.1.

### Legacy redirects (must)

| Legacy | Canonical |
| --- | --- |
| `/admin/partners` | `/partners` |
| `/admin/federation` | `/partners` |
| `/partners/new` | `/partners` |
| `/partners/[id]` | `/partners` |
| `/trading/receivings`, `/trading/receivings/create`, `/trading/receivings/[id]` | `/trading/inbound` (+ `?kind=nexora` on detail) |
| `/trading/receipts` | `/trading/inbound?sourceKind=local` |
| `/admin/products` | `/products` (legacy `/catalog/products` also redirects) |
| `/admin/batches` | `/catalog/batches` |
| `/admin/warehouses` | `/inventory/warehouses` |
| `/admin/inventory` | `/inventory/balances` |

## 2. Role × navigation (UX matrix)

Server policy remains authoritative.

| Role | Primary ERP nav | User-menu → System admin |
| --- | --- | --- |
| administrator | catalog / inventory / partners (full) | Yes → `/admin` |
| staff | catalog / inventory / partners per policy | No |
| approver | read-oriented ERP links | No |
| viewer | read-oriented ERP links | No |

Members manage UI: **administrator only** (under `/admin/members`) — listing table; invite / edit profile (name, email, activate/disable) / assign job roles via modals (not inline forms).

## 3. Cross-cutting requirements

- Auth: unauthenticated visit to protected surface → client redirect `/login?next=…` after session check; APIs return 401/403.
- Theme: light/dark/system (existing ThemeProvider).
- i18n: VI/EN; no M0x/P0x / Keycloak jargon in business copy.
- Index pattern: PageHeader + filters + **full-width** table + row → detail/form.
- Secrets: never re-display partner connection secrets after save.
- Inventory: no client UI to PATCH balances before trading phase.

## 4. Gateway

Unauthenticated GET/HEAD for HTML/static of `/admin*`, `/partners*`, `/catalog*`, `/inventory*` (and later `/trading*`, `/trace*`), plus existing `/erp/*` strip, `/_next/*`, `/assets/*`, `/login`, `/logout`, `/reset-password`.

## 5. DX-Lab mapping (informative)

| H-P-D-I | Prefer concepts |
| --- | --- |
| H | System admin + partners + `/me` |
| P | Trading surface |
| D | Inventory + trace |
| I | AI assistant (P10/P11) |

DX-Lab routes need not mirror ERP prefixes 1:1 but must not document “all ERP under `/admin`”.
