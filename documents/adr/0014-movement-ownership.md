# D14 — One stock-movement owner per business action

- **Status:** Accepted for P00 design, 2026-11-17; real document tests remain P07/P09.
- **Blocks:** P07 document confirms and P09 cross-instance stock accounting.
- **Decision owners:** Dev/team; two G00 reviewers still required.
- **Detailed rationale:** [D14-stock-movement-ownership.md](./D14-stock-movement-ownership.md).

## Decision

Only `GoodsReceipt` (+), `GoodsIssue` (−), `ReceivingConfirmation` (+ actual) and `Stocktake` (± variance) can write `inventory.stock_movement`; zero actual/variance writes no zero movement. `PartnerTransfer` and `SaleRecord` reference an already confirmed issue with matching purpose/lot/quantity and create no second movement. One outbound issue links to at most one transfer or sale in v1. Confirmed document, balance, movement, audit and outbox must commit atomically. ACK does not modify balance.

No new infrastructure is selected by this domain decision. The transaction implementation choice and scratch contention evidence are in [D03](./0003-database-prisma.md) and [its spike](../phase-plan/evidence/spike-d03.md).

## P00 evidence and boundary

- [x] Prisma scratch transaction proved rollback, optimistic version and one-winner stock contention. The scratch tables are not the P07 schema.
- [x] Database/API blueprint assigns the four movement owners; OpenAPI transfer/sale confirm responses require `movementIds:[]`; federation ACK and outbox schemas are separate from receiving. See [contract validation](../phase-plan/evidence/contract-validate.md).
- [ ] Runtime: test all six document types, linked issue uniqueness, zero actual/variance, retry/double confirm, two concurrent confirms, rollback, and A/B/C balances 8/4/4. Owners: P07/P09.

Contract sources: [database schema](../phase-plan/database-schema-v1.md), [API payloads](../phase-plan/api-payloads-v1.md), [event payloads](../phase-plan/event-payloads-v1.md). G00 still awaits human sign-off.
