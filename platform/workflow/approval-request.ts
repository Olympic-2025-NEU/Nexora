// SPDX-License-Identifier: AGPL-3.0-only
import type { ApprovalRequest, ApprovalRequestState } from "@prisma/client";

export type { ApprovalRequest, ApprovalRequestState };
export type Decision = "approved" | "rejected";
export type ApprovalActor = {
  sub: string;
  /** Job roles for this membership (ADR 0018). */
  roles: string[];
  warehouseIds: string[];
  active: boolean;
};
export type ActorResolver = (sub: string) => Promise<ApprovalActor | null>;

export class SelfApprovalError extends Error { readonly code = "SELF_APPROVAL"; }
export class ApprovalScopeError extends Error { readonly code = "APPROVAL_SCOPE"; }
export class DecisionConflictError extends Error { readonly code = "DECISION_CONFLICT"; }
export class VersionConflictError extends Error { readonly code = "VERSION_CONFLICT"; }
export class ApprovalNotReadyError extends Error { readonly code = "APPROVAL_NOT_READY"; }
export class SnapshotMismatchError extends Error { readonly code = "SNAPSHOT_MISMATCH"; }
export class HaltedApprovalError extends Error { readonly code = "HALTED_APPROVAL"; }

/** Flowable candidate group + membership job role for goods-issue approval. */
export const ISSUE_APPROVER_ROLE = "issue_approver";

export function hasScope(actor: ApprovalActor | null, warehouseIds: unknown, role?: string): boolean {
  return !!actor?.active &&
    (!role || actor.roles.includes(role)) &&
    Array.isArray(warehouseIds) &&
    warehouseIds.length > 0 &&
    warehouseIds.every((id) => typeof id === "string" && actor.warehouseIds.includes(id));
}
