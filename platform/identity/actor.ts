// SPDX-License-Identifier: AGPL-3.0-only
import type { OrgUnitId, TenantId, UserId } from "../kernel/id";

/** Người gọi đã xác thực. Vai và đơn vị lấy từ phiên, không lấy từ body. */
export type Actor = {
  userId: UserId;
  tenantId: TenantId;
  unitIds: readonly OrgUnitId[];
  roles: readonly string[];
};
