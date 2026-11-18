// SPDX-License-Identifier: AGPL-3.0-only
import { DomainError } from "@/platform/kernel/errors";
import type { OrganizationId } from "@/platform/kernel/id";

export type Item = {
  id: string;
  organizationId: OrganizationId;
  sku: string;
  name: string;
  unitCode: string;
};

export function createItem(input: Item): Item {
  if (!input.sku.trim() || !input.name.trim() || !input.unitCode.trim()) {
    throw new DomainError("ITEM_IDENTITY_REQUIRED", 422);
  }
  return input;
}
