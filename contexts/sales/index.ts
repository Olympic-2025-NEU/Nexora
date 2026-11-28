// SPDX-License-Identifier: AGPL-3.0-only
export type { StockReservation } from "./application/ports";
export {
  ORDER_NUMBER_MIN_SEQ_WIDTH,
  PAYMENT_METHODS,
  SALES_ORDER_STATUSES,
  allocateOrderNumber,
  assertMoney,
  assertPositiveQuantity,
  formatOrderNumber,
  nextOrderNumber,
  orderNumberDayKey,
  orderNumberPrefix,
  parseOrderNumberSequence,
} from "./domain/sales-order";
export type {
  PaymentMethod,
  SalesOrderLineInput,
  SalesOrderStatus,
} from "./domain/sales-order";
export { createSalesOrderService } from "./application/orders";
export { orderRoute } from "./application/order-http";
export { allocateFefo } from "./application/fefo";

/** Legacy event name kept for context-map compatibility. */
export const salesOrderConfirmed = "sales.order.confirmed";
