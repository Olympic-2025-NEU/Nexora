// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { ApiError, issuePassportQr, revokePassportQr } from "../api-client/client";
import { requireAccessToken } from "../auth/access-token";
import { authConfig } from "../auth/config";

export async function issueQrAction(batchId: string, policyVersion: string) {
  try {
    const token = await requireAccessToken();
    const result = await issuePassportQr(token, batchId, policyVersion);
    const issuedUrl = new URL(result.qrUrl);
    const qrToken = issuedUrl.pathname.match(/^\/passport\/([A-Za-z0-9_-]{43})$/)?.[1];
    if (!qrToken) throw new Error("QR response missing token");
    const publicUrl = new URL(`/dxlab/passport/${qrToken}`, authConfig().publicBaseUrl);
    return { ok: true as const, data: { url: publicUrl.toString(), tokenId: result.tokenId } };
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    return { ok: false as const, status,
      message: status === 409 ? "Passport chưa được công bố hoặc lô chưa đủ điều kiện."
        : status === 403 ? "Bạn không có quyền phát hành QR cho lô này."
          : "Không phát hành được QR." };
  }
}

export async function revokeQrAction(batchId: string, tokenId: string) {
  try {
    const token = await requireAccessToken();
    await revokePassportQr(token, batchId, tokenId, "Thu hồi từ DX-Lab");
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: error instanceof ApiError
      ? `Không thu hồi được QR (${error.status}).` : "Không thu hồi được QR." };
  }
}
