// SPDX-License-Identifier: AGPL-3.0-only
import type { OrganizationId, UserId } from "../kernel/id";

export type AuditEntry = {
  organizationId: OrganizationId;
  actorId: UserId;
  action: string;
  targetType: string;
  targetId: string;
};

export type AuditRecorder = {
  record(entry: AuditEntry): Promise<void>;
};
