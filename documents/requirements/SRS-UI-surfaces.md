# SRS — ERP UI surfaces (appendix)

**Status:** Canonical UI route requirements (ADR 0016)  
**Applies to:** Next.js ERP under `app/` (not DX-Lab `apps/dx-lab/`)  
**Catalog detail:** [`SRS-product-catalog.md`](./SRS-product-catalog.md)

## 1. Surfaces and routes

**Shell:** one shared ERP `AppShell` (header + primary nav). System admin is opened from the **user menu** (administrator only), not a second site / workspace switcher.

| ID | Area | Prefix | Required screens (MVP UI) |
| --- | --- | --- | --- |
| S-ERP | Primary nav | `/catalog`, `/inventory`, `/partners` | Products **index (table rows)**, product detail/variants; batches; warehouses; balances; partners index |
| S-CAT | Catalog masters | `/catalog` | Categories tree; UOM master; price lists + items (per product-catalog SRS) |
| S-ADM | System admin (user-menu entry) | `/admin` | Hub (system only); Organization; Members |
| S-TRD | Trading | `/trading` | From P07 |
| S-TRC | Trace | `/trace` | From P08 |

### Catalog routes (requirements — implement with API)

| Route | Requirement |
| --- | --- |
| `/catalog/products` | Default **index table** (not empty create form): name, category, active, variant count, primary retail if available |
| `/catalog/products/new`, `/catalog/products/[id]` | Create / detail; manage variants, variant UOMs, prices |
| `/catalog/categories` | Category tree CRUD |
| `/catalog/uom` | UOM master (system default CÁI visible) |
| `/catalog/pricing` | Price lists (general vs coded) + items |

Until schema ADR + API ship, screens may show an honest empty/disabled state — **not** fake CRUD.

### Legacy redirects (must)

| Legacy | Canonical |
| --- | --- |
| `/admin/partners` | `/partners` |
| `/admin/products` | `/catalog/products` |
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

Members manage UI: **administrator only** (under `/admin/members`).

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
