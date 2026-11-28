// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DOCUMENT_ACTIONS, DOCUMENT_RULES, DOCUMENT_STATUSES, DOCUMENT_TYPES,
  InvalidTransitionError, applyDocumentAction, assertCorrection, assertIssueLink,
  assertReceivingLines, documentStockEffect,
  type DocumentAction, type DocumentStatus, type DocumentType, type IssueLine,
} from "./document";

function fails(code: string, httpStatus: 409 | 422, run: () => unknown) {
  assert.throws(run, (error: unknown) =>
    error instanceof InvalidTransitionError && error.code === code && error.httpStatus === httpStatus);
}

const directExpected: Partial<Record<DocumentStatus, Partial<Record<DocumentAction, DocumentStatus>>>> = {
  draft: { edit: "draft", confirm: "confirmed", cancel: "cancelled" },
  pending_approval: {}, approved: {}, confirmed: {}, cancelled: {}, rejected: {},
};
const issueExpected: Partial<Record<DocumentStatus, Partial<Record<DocumentAction, DocumentStatus>>>> = {
  draft: { edit: "draft", submit: "pending_approval", cancel: "cancelled" },
  pending_approval: { approve: "approved", reject: "rejected", cancel: "cancelled" },
  approved: { confirm: "confirmed", cancel: "cancelled" },
  confirmed: {}, cancelled: {}, rejected: {},
};
const expectedByType: Record<DocumentType, typeof directExpected> = {
  goods_receipt: directExpected,
  goods_issue: issueExpected,
  partner_transfer: directExpected,
  receiving_confirmation: directExpected,
  stocktake: directExpected,
  sale_record: directExpected,
};
const approval = {
  state: "approved" as const, actorSub: "approver", approvedLineSnapshotSha256: "hash",
  currentLineSnapshotSha256: "hash", actorHasWarehouseScope: true,
};

test("full 6 type × 6 status × 7 action matrix matches independent expectations", () => {
  let cells = 0;
  for (const type of DOCUMENT_TYPES) {
    const rule = DOCUMENT_RULES[type];
    assert.equal(rule.requiresApproval, type === "goods_issue");
    assert.deepEqual(rule.reachableStatuses,
      type === "goods_issue" ? [...DOCUMENT_STATUSES] : ["draft", "confirmed", "cancelled"]);
    assert.equal(new Set(rule.transitions.map(({ from, action }) => `${from}:${action}`)).size,
      rule.transitions.length);
    for (const status of DOCUMENT_STATUSES) {
      for (const action of DOCUMENT_ACTIONS) {
        cells++;
        const expected = expectedByType[type][status]?.[action];
        const matching = rule.transitions.filter((edge) => edge.from === status && edge.action === action);
        assert.equal(matching.length, expected === undefined ? 0 : 1, `${type}/${status}/${action}`);
        if (expected === undefined) {
          fails("WRONG_STATE", 409, () => applyDocumentAction({ type, status, action }));
        } else {
          assert.equal(matching[0].to, expected, `${type}/${status}/${action}`);
          assert.equal(applyDocumentAction({ type, status, action, createdBySub: "creator",
            approval: action === "reject" ? { state: "rejected", actorSub: "approver" } : approval,
          }), expected, `${type}/${status}/${action}`);
        }
      }
    }
    assert.ok(Object.isFrozen(rule) && Object.isFrozen(rule.fields) &&
      Object.isFrozen(rule.fields.line) && Object.isFrozen(rule.transitions));
  }
  assert.equal(cells, 252);
});

test("field and stock ownership matrix matches schema enums and D14", () => {
  assert.deepEqual(DOCUMENT_TYPES, ["goods_receipt", "goods_issue", "partner_transfer",
    "receiving_confirmation", "stocktake", "sale_record"]);
  assert.deepEqual(DOCUMENT_STATUSES, ["draft", "pending_approval", "approved", "confirmed", "cancelled", "rejected"]);
  assert.deepEqual(DOCUMENT_TYPES.map((type) => DOCUMENT_RULES[type].stockEffect),
    ["receipt", "issue", "none", "receiving", "variance", "none"]);
  for (const type of DOCUMENT_TYPES) {
    for (const field of ["line_no", "warehouse_id", "batch_id", "product_variant_id", "product_id", "uom_id"]) {
      assert.ok(DOCUMENT_RULES[type].fields.line.includes(field));
    }
  }
  assert.deepEqual(DOCUMENT_RULES.goods_issue.fields.header,
    ["document_type", "document_number", "created_by_sub", "correlation_id", "issue_purpose"]);
  assert.deepEqual(DOCUMENT_RULES.receiving_confirmation.fields.line.slice(-3),
    ["quantity", "actual_quantity", "source_line_ref"]);
  assert.deepEqual(DOCUMENT_RULES.stocktake.fields.line.slice(-1), ["counted_quantity"]);
});

test("draft/cancel/reject have no stock effect or path to confirm outside the rules", () => {
  for (const type of DOCUMENT_TYPES) {
    for (const status of ["draft", "pending_approval", "approved", "cancelled", "rejected"] as const) {
      assert.equal(documentStockEffect(type, status), "none");
    }
    for (const status of ["cancelled", "rejected"] as const) {
      fails("WRONG_STATE", 409, () => applyDocumentAction({ type, status, action: "confirm" }));
    }
  }
  assert.equal(documentStockEffect("goods_receipt", "confirmed"), "receipt");
  assert.equal(documentStockEffect("sale_record", "confirmed"), "none");
});

test("confirmed forbids edit/cancel/delete and second confirm", () => {
  for (const type of DOCUMENT_TYPES) {
    for (const action of ["edit", "cancel", "delete", "confirm"] as const) {
      fails("WRONG_STATE", 409, () => applyDocumentAction({ type, status: "confirmed", action }));
    }
  }
});

test("approver == creator returns 422; late decision after cancel has no effect", () => {
  for (const action of ["approve", "reject"] as const) {
    fails("SELF_DECISION", 422, () => applyDocumentAction({ type: "goods_issue",
      status: "pending_approval", action, createdBySub: "same",
      approval: { state: action === "approve" ? "approved" : "rejected", actorSub: "same" },
    }));
    fails("WRONG_STATE", 409, () => applyDocumentAction({ type: "goods_issue",
      status: "cancelled", action, createdBySub: "creator",
      approval: { state: "approved", actorSub: "approver" },
    }));
  }
  fails("APPROVAL_NOT_CONFIRMED", 409, () => applyDocumentAction({ type: "goods_issue",
    status: "pending_approval", action: "approve", createdBySub: "creator",
    approval: { state: "pending", actorSub: "approver" },
  }));
});

test("goods_issue confirm from draft or unapproved bridge returns 409", () => {
  fails("WRONG_STATE", 409, () => applyDocumentAction({ type: "goods_issue", status: "draft", action: "confirm" }));
  fails("APPROVAL_NOT_CONFIRMED", 409, () => applyDocumentAction({ type: "goods_issue",
    status: "approved", action: "confirm", approval: { ...approval, state: "pending" },
  }));
  fails("APPROVAL_LINES_CHANGED", 409, () => applyDocumentAction({ type: "goods_issue",
    status: "approved", action: "confirm", approval: { ...approval, currentLineSnapshotSha256: "changed" },
  }));
  fails("WAREHOUSE_SCOPE_REQUIRED", 422, () => applyDocumentAction({ type: "goods_issue",
    status: "approved", action: "confirm", approval: { ...approval, actorHasWarehouseScope: false },
  }));
});

test("five non-issue types cannot enter pending_approval", () => {
  for (const type of DOCUMENT_TYPES.filter((value) => value !== "goods_issue")) {
    fails("WRONG_STATE", 409, () => applyDocumentAction({ type, status: "draft", action: "submit" }));
    fails("WRONG_STATE", 409, () => applyDocumentAction({ type, status: "pending_approval", action: "approve" }));
  }
});

const issueLines: IssueLine[] = [
  { id: "a", lineNo: 1, warehouseId: "w", batchId: "lot-a", productVariantId: "v", productId: "p", uomId: "u", quantity: "12" },
  { id: "b", lineNo: 2, warehouseId: "w", batchId: "lot-b", productVariantId: "v", productId: "p", uomId: "u", quantity: "2" },
];
const linkedLines = issueLines.map(({ id, ...line }) => ({ ...line, sourceIssueLineId: id }));
const transfer = { targetType: "partner_transfer" as const, issueType: "goods_issue" as const,
  issueStatus: "confirmed" as const, issuePurpose: "partner_transfer" as const,
  alreadyLinked: false, destinationPartnerActive: true, issueLines, linkedLines };

test("transfer link issue purpose=sale returns 422; exact per-line lot/qty and unique link", () => {
  fails("ISSUE_PURPOSE_MISMATCH", 422, () => assertIssueLink({ ...transfer, issuePurpose: "sale" }));
  fails("ISSUE_NOT_CONFIRMED", 422, () => assertIssueLink({ ...transfer, issueStatus: "draft" }));
  fails("ISSUE_ALREADY_LINKED", 409, () => assertIssueLink({ ...transfer, alreadyLinked: true }));
  fails("PARTNER_INACTIVE", 422, () => assertIssueLink({ ...transfer, destinationPartnerActive: false }));
  fails("ISSUE_LINES_MISMATCH", 422, () => assertIssueLink({ ...transfer,
    linkedLines: [{ ...linkedLines[0], quantity: "14" }, { ...linkedLines[1], quantity: "0" }],
  }));
  fails("ISSUE_LINES_MISMATCH", 422, () => assertIssueLink({ ...transfer,
    linkedLines: [{ ...linkedLines[0], batchId: "lot-b" }, { ...linkedLines[1], batchId: "lot-a" }],
  }));
  fails("ISSUE_LINES_MISMATCH", 422, () => assertIssueLink({ ...transfer,
    linkedLines: [linkedLines[0], linkedLines[0]],
  }));
  assert.doesNotThrow(() => assertIssueLink(transfer));
  assert.doesNotThrow(() => assertIssueLink({ ...transfer, targetType: "sale_record", issuePurpose: "sale" }));
});

const correction = { documentId: "new", documentType: "goods_issue" as const,
  correctionOfDocumentId: "original", correctionReason: "Adjust count", sourceType: "goods_issue" as const,
  sourceStatus: "confirmed" as const, existingActiveCorrection: false };

test("correction targeting draft and missing reason return 422", () => {
  fails("CORRECTION_INVALID", 422, () => assertCorrection({ ...correction, sourceStatus: "draft" }));
  fails("CORRECTION_REASON_REQUIRED", 422, () => assertCorrection({ ...correction, correctionReason: "  " }));
  fails("CORRECTION_INVALID", 422, () => assertCorrection({ ...correction, correctionOfDocumentId: undefined }));
  fails("CORRECTION_INVALID", 422, () => assertCorrection({ ...correction, correctionOfDocumentId: "new" }));
  fails("CORRECTION_ALREADY_ACTIVE", 409, () => assertCorrection({ ...correction, existingActiveCorrection: true }));
  assert.doesNotThrow(() => assertCorrection(correction));
  assert.doesNotThrow(() => assertCorrection({ ...correction, correctionOfDocumentId: "prior-correction" }));
  assert.doesNotThrow(() => assertCorrection({ documentId: "normal", documentType: "stocktake" }));
});

const receiving = { sourceLines: [{ id: "x", quantity: "12" }, { id: "y", quantity: "2.500" }],
  lines: [{ sourceLineRef: "x", quantity: "12", actualQuantity: "10" },
    { sourceLineRef: "y", quantity: "2.5", actualQuantity: "0" }], discrepancyReason: "Short delivery" };

test("receiving actual > sent returns 422; zero/partial and exact source coverage", () => {
  assert.doesNotThrow(() => assertReceivingLines(receiving));
  fails("RECEIVING_OVER_SENT", 422, () => assertReceivingLines({ ...receiving,
    lines: [{ ...receiving.lines[0], actualQuantity: "12.001" }, receiving.lines[1]],
  }));
  fails("DISCREPANCY_REASON_REQUIRED", 422, () => assertReceivingLines({ ...receiving, discrepancyReason: " " }));
  fails("RECEIVING_LINES_MISMATCH", 422, () => assertReceivingLines({ ...receiving, lines: receiving.lines.slice(0, 1) }));
  fails("RECEIVING_LINES_MISMATCH", 422, () => assertReceivingLines({ ...receiving,
    lines: [receiving.lines[0], { ...receiving.lines[1], sourceLineRef: "x" }],
  }));
  fails("RECEIVING_QUANTITY_INVALID", 422, () => assertReceivingLines({ ...receiving,
    lines: [receiving.lines[0], { ...receiving.lines[1], actualQuantity: "0.0001" }],
  }));
  assert.doesNotThrow(() => assertReceivingLines({ ...receiving,
    lines: receiving.sourceLines.map(({ id, quantity }) => ({ sourceLineRef: id, quantity, actualQuantity: quantity })),
    discrepancyReason: undefined,
  }));
});
