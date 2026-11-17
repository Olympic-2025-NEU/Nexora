# D07 — Decimal, unit and origin-lot identity

- **Status:** Accepted for P00 design, 2026-11-17; application constraints remain P06/P07.
- **Blocks:** P06 catalog/inventory and P07 document confirm.
- **Decision owners:** Dev/team; two G00 reviewers still required.
- **Detailed rationale and SQL observations:** [D07-quantity-unit-lot.md](./D07-quantity-unit-lot.md).

## Decision

Store stock as PostgreSQL `numeric(20,3)` and exchange decimal strings in JSON. Reject values with more than three fraction digits before PostgreSQL can round them. `EA` is integral; `KG` and `L` allow up to three fraction digits; no unit conversion in v1. Confirm cannot make a balance negative. Batch origin is the immutable `(origin_issuer_instance_id, origin_lot_id)` pair, distinct from each sender's local batch ID. A local code or SKU alone never identifies a cross-instance lot. Issue expiry is evaluated in the organization timezone; the expiry date itself remains valid.

This is a domain/schema decision on the chosen PostgreSQL/Prisma stack; infrastructure pin/license/RAM are in [D03](./0003-database-prisma.md) and [D03 evidence](../phase-plan/evidence/spike-d03.md).

## P00 evidence and boundary

- [x] SQL spike showed PostgreSQL rounding beyond scale, numeric overflow and issuer-qualified uniqueness (see detailed D07).
- [x] Contract fixtures reject invalid decimal/zero lot and compare quantities with integer milliscale arithmetic; A→B→C preserves the origin lot. See [contract validation](../phase-plan/evidence/contract-validate.md).
- [x] Prisma D03 scratch transaction proved rollback and one-winner stock contention primitive; it is not the six-use-case schema.
- [ ] Runtime: reject overprecision/EA fraction/expiry cases at API and DB constraints, enforce unit/product/lot FK and two concurrent issues on the real schema. Owners: P06/P07.

Contract consumers: [database schema](../phase-plan/database-schema-v1.md), [API payloads](../phase-plan/api-payloads-v1.md), [event payloads](../phase-plan/event-payloads-v1.md). G00 still awaits human sign-off.
