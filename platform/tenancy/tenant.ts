// SPDX-License-Identifier: AGPL-3.0-only
import type { TenantId } from "../kernel/id";

export type Tenant = {
  id: TenantId;
  name: string;
};

/** Mọi câu lệnh nghiệp vụ phải mang tenant của actor, không nhận tenant từ client. */
export function tenantOf(actorTenantId: TenantId): TenantId {
  return actorTenantId;
}
