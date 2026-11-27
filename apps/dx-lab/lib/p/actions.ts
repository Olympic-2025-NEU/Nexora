// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import {
  ApiError,
  createTradingDocument,
  decideApproval,
  getIssueSources,
  getReceivingBatchOptions,
  patchTradingDocument,
  tradingAction,
  type TradingKind,
} from "../api-client/client";
import { requireAccessToken } from "../auth/access-token";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

function fail(error: unknown, fallback: string): ActionResult<never> {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return { ok: false, status: 409, message: "Xung đột phiên bản hoặc trạng thái. Tải lại rồi thử lại." };
    }
    if (error.status === 403) {
      return { ok: false, status: 403, message: "Không có quyền hoặc bị chặn self-approve." };
    }
    if (error.status === 429) {
      return { ok: false, status: 429, message: "Quá nhiều yêu cầu. Đợi rồi thử lại — không bấm Confirm lặp." };
    }
    if (error.status === 503) {
      return { ok: false, status: 503, message: "Core/ERP tạm xuống. Giữ Draft; thử lại sau." };
    }
    return {
      ok: false,
      status: error.status,
      message: error.code ? `${fallback} (${error.code})` : `${fallback} (${error.status})`,
    };
  }
  return { ok: false, status: 500, message: fallback };
}

export async function editDocumentAction(
  kind: TradingKind,
  id: string,
  version: number,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  try {
    assertNoOrganizationId(body);
    const token = await requireAccessToken();
    await patchTradingDocument(token, kind, id, version, body);
    revalidatePath(`/operations/${kind}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Không sửa được Draft");
  }
}

export async function loadIssueSourcesAction(
  batchId: string,
  warehouseId: string,
): Promise<ActionResult<{ sourceLineId: string; availableQuantity: string; uomId: string }[]>> {
  try {
    const token = await requireAccessToken();
    const rows = await getIssueSources(token, batchId, warehouseId);
    return { ok: true, data: rows.map((row) => ({
      sourceLineId: String(row.sourceLineId),
      availableQuantity: String(row.availableQuantity),
      uomId: String(row.uomId),
    })) };
  } catch (error) {
    return fail(error, "Không tải được nguồn xuất");
  }
}

export async function loadReceivingBatchesAction(messageId: string): Promise<ActionResult<
  { sourceLineId: string; batches: { id: string; label: string }[] }[]
>> {
  try {
    const token = await requireAccessToken();
    const rows = await getReceivingBatchOptions(token, messageId);
    return { ok: true, data: rows.map((row) => ({
      sourceLineId: String(row.sourceLineId),
      batches: (Array.isArray(row.batches) ? row.batches : []).map((batch) => ({
        id: String(batch.id), label: String(batch.localCode ?? batch.id),
      })),
    })) };
  } catch (error) {
    return fail(error, "Không tải được lô nhận phù hợp");
  }
}

function assertNoOrganizationId(body: object) {
  if ("organizationId" in body) {
    throw new Error("organizationId must not be sent; tenant comes from the session actor");
  }
}

export async function createDocumentAction(
  kind: TradingKind,
  body: Record<string, unknown>,
): Promise<ActionResult<{ id: string }>> {
  try {
    assertNoOrganizationId(body);
    const token = await requireAccessToken();
    const doc = await createTradingDocument(token, kind, body);
    revalidatePath("/operations");
    return { ok: true, data: { id: String(doc.id) } };
  } catch (error) {
    return fail(error, "Không tạo được chứng từ");
  }
}

export async function documentActionAction(
  kind: TradingKind,
  id: string,
  action: string,
  version: number,
  body: Record<string, unknown> = {},
): Promise<ActionResult> {
  try {
    assertNoOrganizationId(body);
    const token = await requireAccessToken();
    await tradingAction(token, kind, id, action, version, body);
    revalidatePath("/operations");
    revalidatePath(`/operations/${kind}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, `Không thực hiện được ${action}`);
  }
}

export async function decideApprovalAction(
  approvalRequestId: string,
  decision: "approve" | "reject",
  version: number,
  note?: string,
): Promise<ActionResult> {
  try {
    const token = await requireAccessToken();
    await decideApproval(token, approvalRequestId, decision, version, note);
    revalidatePath("/work");
    revalidatePath("/work/approvals");
    revalidatePath("/operations");
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Không ghi được quyết định phê duyệt");
  }
}
