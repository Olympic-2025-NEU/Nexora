# ADR 0018 — Multi job-role membership RBAC

**Status:** Accepted  
**Date:** 2026-11-28  
**Supersedes (partial):** BRD §5 “Dynamic RBAC role editor (roles are fixed membership codes)” insofar as it implied a **single** membership role; fixed role codes remain (no dynamic permission editor). Relates to [0004](./0004-identity-session-keycloak.md), [0006](./0006-workflow-flowable-goods-issue.md).

## Context

v1 used four coarse membership roles (`administrator`, `staff`, `approver`, `viewer`) with exactly one role per user. `staff` owned nearly all trading mutations; `approver` only Flowable decisions. Operators could not express job boundaries (sales vs receiving vs stocktake) without over-granting.

## Decision

1. **Fixed job-role codes** (no UI to invent permissions):  
   `administrator`, `catalog_manager`, `inventory_clerk`, `sales_clerk`, `stocktake_clerk`, `issue_approver`, `quality_officer`, `auditor`.
2. **Many roles per membership** via `system.membership_role`; policy uses **union** of roles. DB remains authoritative; Keycloak realm roles mirror the set.
3. **No dynamic RBAC editor** in this phase — only multi-select among fixed codes.
4. **MFA (TOTP)** required for `administrator` and `issue_approver` (replacing legacy `approver`).
5. **Legacy single-role codes** (`staff`, `approver`, `viewer`) are migrated away and removed from the managed Keycloak set after backfill.
6. Column `membership.role` is retained temporarily as a **primary** denormalized role (priority-ordered) for indexes/compat; authority for authz is `membership_role`.

### Migrate mapping

| Legacy | New roles |
|--------|-----------|
| `administrator` | `administrator` |
| `staff` | `catalog_manager` + `inventory_clerk` + `sales_clerk` + `stocktake_clerk` |
| `approver` | `issue_approver` + `auditor` |
| `viewer` | `auditor` |

### Trading state permissions (summary)

- Receipt / transfer / receiving mutate+confirm: `inventory_clerk` (+ admin bypass).
- Issue create/edit/submit/confirm: `inventory_clerk`; approve/reject: `issue_approver` via `workflow:approval:*` (SoD unchanged).
- Stocktake: `stocktake_clerk`.
- Sale / POS: `sales_clerk`.
- Catalog manage: `catalog_manager`.
- Quality ops: `quality_officer`.
- Broad read: clerks + `issue_approver` + `auditor` as listed in `security.md` / `policy.ts`.

## Consequences

- Members invite/PATCH accept `roles: string[]` (min 1); UI multi-select.
- Flowable candidate group / app checks use `issue_approver`.
- Tests and provisioning runbooks must seed multi-role users.
- Partner/public actors unchanged.
