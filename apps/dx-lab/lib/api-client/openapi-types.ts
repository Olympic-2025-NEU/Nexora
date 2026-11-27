// SPDX-License-Identifier: AGPL-3.0-only
// Generated from contracts/openapi/nexora-v1.yaml by scripts/generate-dxlab-api-types.mjs.
export interface Me {
  userId: string;
  organizationId: string;
  roles: ("administrator" | "staff" | "approver" | "viewer")[];
  unitIds: (string)[];
  displayName: string;
}
export interface Organization {
  id: string;
  instanceId: string;
  code: string;
  name: string;
  timezone: string;
  status: string;
  version: number;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
}
export interface OrganizationPatch {
  name?: string;
  contactEmail?: (string) | null;
  contactPhone?: (string) | null;
  address?: (string) | null;
  timezone?: string;
  version?: number;
}
export interface Member {
  id: string;
  keycloakSub: string;
  displayName: string;
  email?: string;
  role: "administrator" | "staff" | "approver" | "viewer";
  status: string;
  warehouseIds?: (string)[];
  version: number;
  provisionalPassword?: string;
  keycloakCreated?: boolean;
}
export interface MemberCreate {
  username: string;
  displayName: string;
  email?: string;
  role: "administrator" | "staff" | "approver" | "viewer";
  warehouseIds?: (string)[];
  temporaryPassword?: string;
}
export interface MemberPatch {
  role?: "administrator" | "staff" | "approver" | "viewer";
  status?: "active" | "disabled";
  displayName?: string;
  email?: (string) | null;
  warehouseIds?: (string)[];
  version?: number;
}
export interface Partner {
  id: string;
  issuerInstanceId: string;
  code: string;
  displayName: string;
  contactEmail?: string;
  status: string;
  connectionStatus?: string;
  version: number;
}
export interface PartnerCreate {
  issuerInstanceId: string;
  code: string;
  displayName: string;
  contactEmail?: string;
}
export interface PartnerPatch {
  displayName?: string;
  status?: "active" | "suspended";
  contactEmail?: (string) | null;
  version?: number;
}
export interface PartnerConnectionInput {
  endpointUrl: string;
  outboundTokenUrl: string;
  outboundClientId: string;
  outboundSecretRef: string;
  outboundAudience: string;
  inboundClientId: string;
  allowedInboundScope: string;
  status?: "active" | "rotating" | "disabled";
}
export interface PartnerConnectionView {
  partnerId: string;
  endpointHost: string;
  status: string;
  rotatedAt?: string;
}
export interface ApprovalTask {
  approvalRequestId: string;
  documentId: string;
  documentNumber: string;
  documentType: string;
  creatorSub: string;
  submittedAt: string;
  ageSeconds: number;
  warehouseIds: (string)[];
  lineHash: string;
  approvalState: string;
  processDefinitionVersion: number;
}
export interface FileMetadata {
  id: string;
  mimeType: string;
  sizeBytes: number;
  scanState: "pending" | "clean" | "infected" | "error";
  visibility: string;
  checksum: string;
  scanAttempts?: number;
  scanErrorCode?: (string) | null;
  nextScanAt?: (string) | null;
  quarantinePurgedAt?: (string) | null;
}
