// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import {
  acknowledgeQualityIssue,
  ApiError,
  resolveQualityIssue,
} from "../api-client/client";
import { requireAccessToken } from "../auth/access-token";

export type QualityActionResult =
  | { ok: true }
  | { ok: false; message: string };

export async function acknowledgeQualityIssueAction(
  id: string,
  version: number,
  reason: string,
): Promise<QualityActionResult> {
  try {
    const token = await requireAccessToken();
    await acknowledgeQualityIssue(token, id, version, reason);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, message: `Acknowledge failed (${error.status}).` };
    }
    return { ok: false, message: "Acknowledge failed." };
  }
}

export async function resolveQualityIssueAction(
  id: string,
  version: number,
  reason: string,
): Promise<QualityActionResult> {
  try {
    const token = await requireAccessToken();
    await resolveQualityIssue(token, id, version, reason);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, message: `Resolve failed (${error.status}).` };
    }
    return { ok: false, message: "Resolve failed." };
  }
}
