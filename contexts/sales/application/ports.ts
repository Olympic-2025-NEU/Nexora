// SPDX-License-Identifier: AGPL-3.0-only
import type { OrganizationId } from "@/platform/kernel/id";

/**
 * Port owned by sales.
 * Inventory implements this port. Sales does not import the inventory context.
 */
export type StockReservation = {
  reserve(input: {
    organizationId: OrganizationId;
    orderId: string;
    lines: readonly { itemId: string; quantity: number }[];
  }): Promise<void>;
};
