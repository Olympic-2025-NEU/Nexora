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

export type DocumentErrorCode =
  | "WRONG_STATE" | "SELF_DECISION" | "APPROVAL_NOT_CONFIRMED" | "APPROVAL_LINES_CHANGED"
  | "WAREHOUSE_SCOPE_REQUIRED" | "ISSUE_PURPOSE_MISMATCH" | "ISSUE_NOT_CONFIRMED"
  | "ISSUE_ALREADY_LINKED" | "ISSUE_LINES_MISMATCH" | "PARTNER_INACTIVE"
  | "CORRECTION_INVALID" | "CORRECTION_REASON_REQUIRED" | "CORRECTION_ALREADY_ACTIVE"
  | "RECEIVING_LINES_MISMATCH" | "RECEIVING_QUANTITY_INVALID" | "RECEIVING_OVER_SENT"
  | "DISCREPANCY_REASON_REQUIRED";

const businessErrors: readonly DocumentErrorCode[] = [
  "SELF_DECISION", "WAREHOUSE_SCOPE_REQUIRED", "ISSUE_PURPOSE_MISMATCH", "ISSUE_NOT_CONFIRMED",
  "ISSUE_LINES_MISMATCH", "PARTNER_INACTIVE", "CORRECTION_INVALID", "CORRECTION_REASON_REQUIRED",
  "RECEIVING_LINES_MISMATCH", "RECEIVING_QUANTITY_INVALID", "RECEIVING_OVER_SENT",
  "DISCREPANCY_REASON_REQUIRED",
];

export class InvalidTransitionError extends Error {
  readonly httpStatus: 409 | 422;

  constructor(readonly code: DocumentErrorCode) {
    super(code);
    this.name = "InvalidTransitionError";
    this.httpStatus = businessErrors.includes(code) ? 422 : 409;
  }
}

export type ApprovalSnapshot = Readonly<{
  state: "approved" | "rejected" | "pending" | "cancelled" | "halted";
  actorSub?: string;
  approvedLineSnapshotSha256?: string;
  currentLineSnapshotSha256?: string;
  actorHasWarehouseScope?: boolean;
}>;

export function applyDocumentAction(input: Readonly<{
  type: DocumentType;
  status: DocumentStatus;
  action: DocumentAction;
  createdBySub?: string;
  approval?: ApprovalSnapshot;
}>): DocumentStatus {
  const rule = DOCUMENT_RULES[input.type].transitions.find(
    (item) => item.from === input.status && item.action === input.action,
  );
  if (!rule) throw new InvalidTransitionError("WRONG_STATE");
  if (rule.actorRule === "approver_not_creator") {
    const decision = input.action === "approve" ? "approved" : "rejected";
    if (input.approval?.state !== decision) {
      throw new InvalidTransitionError("APPROVAL_NOT_CONFIRMED");
    }
    if (!input.createdBySub || !input.approval.actorSub) {
      throw new InvalidTransitionError("APPROVAL_NOT_CONFIRMED");
    }
    if (input.createdBySub === input.approval.actorSub) {
      throw new InvalidTransitionError(rule.errorCode);
    }
  }
  if (rule.actorRule === "approved_issue_confirm") {
    if (input.approval?.state !== "approved") {
      throw new InvalidTransitionError(rule.errorCode);
    }
    if (!input.approval.approvedLineSnapshotSha256 ||
        input.approval.approvedLineSnapshotSha256 !== input.approval.currentLineSnapshotSha256) {
      throw new InvalidTransitionError("APPROVAL_LINES_CHANGED");
    }
    if (input.approval.actorHasWarehouseScope !== true) {
      throw new InvalidTransitionError("WAREHOUSE_SCOPE_REQUIRED");
    }
  }
  return rule.to;
}

export function documentStockEffect(type: DocumentType, status: DocumentStatus): StockEffect {
  return status === "confirmed" ? DOCUMENT_RULES[type].stockEffect : "none";
}

export type IssueLine = Readonly<{
  id: string;
  lineNo: number;
  warehouseId: string;
  batchId: string;
  productVariantId: string;
  productId: string;
  uomId: string;
  quantity: string;
}>;

export type LinkedIssueLine = Omit<IssueLine, "id"> & Readonly<{ sourceIssueLineId: string }>;

export function assertIssueLink(input: Readonly<{
  targetType: "partner_transfer" | "sale_record";
  issueType: DocumentType;
  issueStatus: DocumentStatus;
  issuePurpose: IssuePurpose;
  alreadyLinked: boolean;
  destinationPartnerActive?: boolean;
  issueLines: readonly IssueLine[];
  linkedLines: readonly LinkedIssueLine[];
}>): void {
  const purpose = input.targetType === "partner_transfer" ? "partner_transfer" : "sale";
  if (input.issueType !== "goods_issue" || input.issuePurpose !== purpose) {
    throw new InvalidTransitionError("ISSUE_PURPOSE_MISMATCH");
  }
  if (input.issueStatus !== "confirmed") throw new InvalidTransitionError("ISSUE_NOT_CONFIRMED");
  if (input.alreadyLinked) throw new InvalidTransitionError("ISSUE_ALREADY_LINKED");
  if (input.targetType === "partner_transfer" && input.destinationPartnerActive !== true) {
    throw new InvalidTransitionError("PARTNER_INACTIVE");
  }
  const source = new Map(input.issueLines.map((line) => [line.id, line]));
  if (!source.size || source.size !== input.issueLines.length || input.linkedLines.length !== source.size) {
    throw new InvalidTransitionError("ISSUE_LINES_MISMATCH");
  }
  for (const line of input.linkedLines) {
    const original = source.get(line.sourceIssueLineId);
    if (!original || original.lineNo !== line.lineNo ||
        original.warehouseId !== line.warehouseId || original.batchId !== line.batchId ||
        original.productVariantId !== line.productVariantId || original.productId !== line.productId ||
        original.uomId !== line.uomId || original.quantity !== line.quantity) {
      throw new InvalidTransitionError("ISSUE_LINES_MISMATCH");
    }
    source.delete(line.sourceIssueLineId);
  }
  if (source.size) throw new InvalidTransitionError("ISSUE_LINES_MISMATCH");
}

export function assertCorrection(input: Readonly<{
  documentId: string;
  documentType: DocumentType;
  correctionOfDocumentId?: string | null;
  correctionReason?: string | null;
  sourceType?: DocumentType;
  sourceStatus?: DocumentStatus;
  existingActiveCorrection?: boolean;
}>): void {
  if (input.correctionOfDocumentId == null && input.correctionReason == null) return;
  if (!input.correctionReason?.trim()) throw new InvalidTransitionError("CORRECTION_REASON_REQUIRED");
  if (!input.correctionOfDocumentId || input.correctionOfDocumentId === input.documentId ||
      input.sourceType !== input.documentType || input.sourceStatus !== "confirmed") {
    throw new InvalidTransitionError("CORRECTION_INVALID");
  }
  if (input.existingActiveCorrection) throw new InvalidTransitionError("CORRECTION_ALREADY_ACTIVE");
}

function decimalQuantity(value: string): string {
  if (!/^(?:0|[1-9]\d{0,16})(?:\.\d{1,3})?$/.test(value)) {
    throw new InvalidTransitionError("RECEIVING_QUANTITY_INVALID");
  }
  const [whole, fraction = ""] = value.split(".");
  return whole.padStart(17, "0") + fraction.padEnd(3, "0");
}

export function assertReceivingLines(input: Readonly<{
  sourceLines: readonly Readonly<{ id: string; quantity: string }>[];
  lines: readonly Readonly<{ sourceLineRef: string; quantity: string; actualQuantity: string }>[];
  discrepancyReason?: string | null;
}>): void {
  const source = new Map(input.sourceLines.map((line) => [line.id, line.quantity]));
  if (!source.size || source.size !== input.sourceLines.length || source.size !== input.lines.length) {
    throw new InvalidTransitionError("RECEIVING_LINES_MISMATCH");
  }
  let discrepancy = false;
  for (const line of input.lines) {
    const sent = source.get(line.sourceLineRef);
    if (sent === undefined || decimalQuantity(sent) !== decimalQuantity(line.quantity)) {
      throw new InvalidTransitionError("RECEIVING_LINES_MISMATCH");
    }
    const actual = decimalQuantity(line.actualQuantity);
    if (actual > decimalQuantity(sent)) throw new InvalidTransitionError("RECEIVING_OVER_SENT");
    if (actual !== decimalQuantity(sent)) discrepancy = true;
    source.delete(line.sourceLineRef);
  }
  if (source.size) throw new InvalidTransitionError("RECEIVING_LINES_MISMATCH");
  if (discrepancy && !input.discrepancyReason?.trim()) {
    throw new InvalidTransitionError("DISCREPANCY_REASON_REQUIRED");
  }
}
