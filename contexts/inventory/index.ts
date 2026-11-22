// SPDX-License-Identifier: AGPL-3.0-only
export { assertCanReserve } from "./domain/reservation";
export type { ReservationRequest } from "./domain/reservation";
export * from "./domain/types";
export { createInventoryRepos } from "./infrastructure/prisma-repos";
export {
  adjustStock,
  findBalancesOrdered,
  openStockBalance,
} from "./application/adjust-stock";
export type {
  AdjustStockInput,
  AdjustStockResult,
  OpenStockBalanceInput,
} from "./application/adjust-stock";
