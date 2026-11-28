// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { ApiError, aiChat, aiDraftCreate, aiDraftPropose } from "../api-client/client";
import { requireAccessToken } from "../auth/access-token";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

function fail(error: unknown, fallback: string): ActionResult<never> {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return { ok: false, status: 403, message: "Không có quyền dùng tool AI này." };
    }
    if (error.status === 503) {
      return { ok: false, status: 503, message: "AI/core tạm thời không sẵn sàng — thử truy vấn trực tiếp." };
    }
    return {
      ok: false,
      status: error.status,
      message: error.code ? `${fallback} (${error.code})` : `${fallback} (${error.status})`,
    };
  }
  return { ok: false, status: 500, message: fallback };
}

export async function aiChatAction(
  body: { question: string; batchId?: string; lotCode?: string; issuer?: string },
): Promise<ActionResult<Record<string, unknown>>> {
  try {
    const token = await requireAccessToken();
    return { ok: true, data: await aiChat(token, body) };
  } catch (error) {
    return fail(error, "Không hỏi được trợ lý");
  }
}

export async function aiDraftProposeAction(
  body: { request: string; batchId?: string; lotCode?: string; issuer?: string },
): Promise<ActionResult<Record<string, unknown>>> {
  try {
    const token = await requireAccessToken();
    return { ok: true, data: await aiDraftPropose(token, body) };
  } catch (error) {
    return fail(error, "Không đề xuất được draft");
  }
}

export async function aiDraftCreateAction(
  body: { proposalId: string; fields: Record<string, string>; note?: string },
): Promise<ActionResult<Record<string, unknown>>> {
  try {
    const token = await requireAccessToken();
    return { ok: true, data: await aiDraftCreate(token, body) };
  } catch (error) {
    return fail(error, "Không tạo được draft từ proposal");
  }
}
