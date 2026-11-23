// SPDX-License-Identifier: AGPL-3.0-only
export const DOCUMENT_TYPES = Object.freeze([
  "goods_receipt", "goods_issue", "partner_transfer",
  "receiving_confirmation", "stocktake", "sale_record",
] as const);

export const DOCUMENT_STATUSES = Object.freeze([
  "draft", "pending_approval", "approved", "confirmed", "cancelled", "rejected",
] as const);

export const DOCUMENT_ACTIONS = Object.freeze([
  "edit", "submit", "approve", "reject", "confirm", "cancel", "delete",
] as const);

export type DocumentType = typeof DOCUMENT_TYPES[number];
export type DocumentStatus = typeof DOCUMENT_STATUSES[number];
export type DocumentAction = typeof DOCUMENT_ACTIONS[number];
export type IssuePurpose = "partner_transfer" | "sale" | "other";
export type StockEffect = "receipt" | "issue" | "receiving" | "variance" | "none";

export type DocumentTransition = Readonly<{
  from: DocumentStatus;
  action: DocumentAction;
  to: DocumentStatus;
  actorRule: "none" | "approver_not_creator" | "approved_issue_confirm";
  errorCode: "WRONG_STATE" | "SELF_DECISION" | "APPROVAL_NOT_CONFIRMED";
}>;

export type DocumentRule = Readonly<{
  stockEffect: StockEffect;
  requiresApproval: boolean;
  reachableStatuses: readonly DocumentStatus[];
  fields: Readonly<{
    header: readonly string[];
    line: readonly string[];
    detail: readonly string[];
  }>;
  transitions: readonly DocumentTransition[];
}>;

const header = Object.freeze(["document_type", "document_number", "created_by_sub", "correlation_id"]);
const line = Object.freeze([
  "line_no", "warehouse_id", "batch_id", "product_variant_id", "product_id", "uom_id",
]);
const directStatuses = Object.freeze(["draft", "confirmed", "cancelled"] as const);
const issueStatuses = DOCUMENT_STATUSES;

function transition(from: DocumentStatus, action: DocumentAction, to: DocumentStatus,
  actorRule: DocumentTransition["actorRule"] = "none",
  errorCode: DocumentTransition["errorCode"] = "WRONG_STATE"): DocumentTransition {
  return Object.freeze({ from, action, to, actorRule, errorCode });
}

const directTransitions = Object.freeze([
  transition("draft", "edit", "draft"),
  transition("draft", "confirm", "confirmed"),
  transition("draft", "cancel", "cancelled"),
]);
const issueTransitions = Object.freeze([
  transition("draft", "edit", "draft"),
  transition("draft", "submit", "pending_approval"),
  transition("pending_approval", "approve", "approved", "approver_not_creator", "SELF_DECISION"),
  transition("pending_approval", "reject", "rejected", "approver_not_creator", "SELF_DECISION"),
  transition("approved", "confirm", "confirmed", "approved_issue_confirm", "APPROVAL_NOT_CONFIRMED"),
  transition("draft", "cancel", "cancelled"),
  transition("pending_approval", "cancel", "cancelled"),
  transition("approved", "cancel", "cancelled"),
]);

function fields(extraHeader: readonly string[], extraLine: readonly string[], detail: readonly string[] = []) {
  return Object.freeze({
    header: Object.freeze([...header, ...extraHeader]),
    line: Object.freeze([...line, ...extraLine]),
    detail: Object.freeze([...detail]),
  });
}

export const DOCUMENT_RULES: Readonly<Record<DocumentType, DocumentRule>> = Object.freeze({
  goods_receipt: Object.freeze({
    stockEffect: "receipt", requiresApproval: false, reachableStatuses: directStatuses,
    fields: fields([], ["quantity"]), transitions: directTransitions,
  }),
  goods_issue: Object.freeze({
    stockEffect: "issue", requiresApproval: true, reachableStatuses: issueStatuses,
    fields: fields(["issue_purpose"], ["quantity"]), transitions: issueTransitions,
  }),
  partner_transfer: Object.freeze({
    stockEffect: "none", requiresApproval: false, reachableStatuses: directStatuses,
    fields: fields([], ["quantity", "source_issue_line_id"], ["linked_issue_id", "destination_partner_id"]),
    transitions: directTransitions,
  }),
  receiving_confirmation: Object.freeze({
    stockEffect: "receiving", requiresApproval: false, reachableStatuses: directStatuses,
    fields: fields([], ["quantity", "actual_quantity", "source_line_ref"],
      ["source_issuer_instance_id", "source_transfer_id", "sent_quantity", "actual_quantity"]),
    transitions: directTransitions,
  }),
  stocktake: Object.freeze({
    stockEffect: "variance", requiresApproval: false, reachableStatuses: directStatuses,
    fields: fields([], ["counted_quantity"]), transitions: directTransitions,
  }),
  sale_record: Object.freeze({
    stockEffect: "none", requiresApproval: false, reachableStatuses: directStatuses,
    fields: fields([], ["quantity", "source_issue_line_id"], ["linked_issue_id", "sold_at"]),
    transitions: directTransitions,
  }),
});
