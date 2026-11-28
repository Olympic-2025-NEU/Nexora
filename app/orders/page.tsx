// SPDX-License-Identifier: AGPL-3.0-only
import { OrdersIndexClient } from "./_components/orders-index-client";

export const instant = false;

export default function OrdersPage() {
  return <OrdersIndexClient />;
}
