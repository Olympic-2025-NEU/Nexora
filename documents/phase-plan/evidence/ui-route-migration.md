# UI route migration (ADR 0016)

**Date:** 2026-11-22  
**Gates:** G05/G06 remain CLOSED for API/DB; this note records **canonical UI paths** superseding legacy `/admin/*` product mounts.

| Evidence / historical path | Canonical path |
| --- | --- |
| `/admin/organization` | `/admin/organization` (unchanged) |
| `/admin/members` | `/admin/members` (unchanged) |
| `/admin/partners` | `/partners` |
| `/admin/products` | `/catalog/products` |
| `/admin/batches` | `/catalog/batches` |
| `/admin/warehouses` | `/inventory/warehouses` |
| `/admin/inventory` | `/inventory/balances` |

Legacy URLs must redirect. Requirements: `documents/requirements/SRS-UI-surfaces.md`.
