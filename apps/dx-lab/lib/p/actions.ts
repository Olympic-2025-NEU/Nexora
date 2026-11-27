// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import {
  ApiError,
  createTradingDocument,
  decideApproval,
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
