// SPDX-License-Identifier: AGPL-3.0-only
import { DomainError } from "@/platform/kernel/errors";
import type { OrganizationId } from "@/platform/kernel/id";

export type PartnerRole = "customer" | "supplier" | "both";

export type Partner = {
  id: string;
  organizationId: OrganizationId;
  code: string;
  name: string;
  role: PartnerRole;
};

export function createPartner(input: Partner): Partner {
  if (!input.code.trim() || !input.name.trim()) {
    throw new DomainError("PARTNER_IDENTITY_REQUIRED", 422);
  }
  return input;
}
