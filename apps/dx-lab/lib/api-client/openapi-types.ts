// SPDX-License-Identifier: AGPL-3.0-only
// Generated from contracts/openapi/nexora-v1.yaml by scripts/generate-dxlab-api-types.mjs.
export interface Me {
  userId: string;
  organizationId: string;
  roles: ("administrator" | "staff" | "approver" | "viewer")[];
  unitIds: (string)[];
  displayName: string;
}
