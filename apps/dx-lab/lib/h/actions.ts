// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import {
  ApiError,
  createMember,
  createPartner,
  patchMember,
  patchOrganization,
  patchPartner,
  putPartnerConnection,
} from "../api-client/client";
import type {
  Member,
  MemberCreate,
  MemberPatch,
  OrganizationPatch,
  PartnerConnectionInput,
  PartnerCreate,
  PartnerPatch,
} from "../api-client/openapi-types";
import { requireAccessToken } from "../auth/access-token";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

function fail(error: unknown, fallback: string): ActionResult<never> {
  if (error instanceof ApiError) {
    const conflict = error.status === 409
      ? "Xung đột phiên bản hoặc ràng buộc nghiệp vụ. Tải lại rồi thử lại."
      : undefined;
    const denied = error.status === 403 ? "Không có quyền thực hiện thao tác này." : undefined;
    return {
      ok: false,
      status: error.status,
      message: conflict ?? denied ?? (error.code ? `${fallback} (${error.code})` : `${fallback} (${error.status})`),
    };
  }
  if (error instanceof Error && error.message === "SESSION_EXPIRED") {
    return { ok: false, status: 401, message: "Phiên đăng nhập đã hết hạn. Đăng nhập lại." };
  }
  return { ok: false, status: 500, message: fallback };
}

function assertNoOrganizationId(body: object) {
  if ("organizationId" in body) {
    throw new Error("organizationId must not be sent; tenant comes from the session actor");
  }
}

export async function saveOrganizationAction(
  body: OrganizationPatch,
  version: number,
): Promise<ActionResult> {
  try {
    assertNoOrganizationId(body);
    const token = await requireAccessToken();
    await patchOrganization(token, body, version);
    revalidatePath("/profile");
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Không lưu được hồ sơ tổ chức");
  }
}

export async function inviteMemberAction(
  body: MemberCreate,
): Promise<ActionResult<Member>> {
  try {
    assertNoOrganizationId(body);
    const token = await requireAccessToken();
    const member = await createMember(token, body);
    revalidatePath("/members");
    return { ok: true, data: member };
  } catch (error) {
    return fail(error, "Không mời được thành viên");
  }
}

export async function patchMemberAction(
  id: string,
  body: MemberPatch,
  version: number,
): Promise<ActionResult> {
  try {
    assertNoOrganizationId(body);
    const token = await requireAccessToken();
    await patchMember(token, id, body, version);
    revalidatePath("/members");
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Không cập nhật được thành viên");
  }
}

export async function createPartnerAction(body: PartnerCreate): Promise<ActionResult<{ id: string }>> {
  try {
    assertNoOrganizationId(body);
    const token = await requireAccessToken();
    const partner = await createPartner(token, body);
    revalidatePath("/partners");
    return { ok: true, data: { id: partner.id } };
  } catch (error) {
    return fail(error, "Không tạo được đối tác");
  }
}

export async function patchPartnerAction(
  id: string,
  body: PartnerPatch,
  version: number,
): Promise<ActionResult> {
  try {
    assertNoOrganizationId(body);
    const token = await requireAccessToken();
    await patchPartner(token, id, body, version);
    revalidatePath("/partners");
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Không cập nhật được đối tác");
  }
}

export async function savePartnerConnectionAction(
  partnerId: string,
  body: PartnerConnectionInput,
): Promise<ActionResult<{ endpointHost: string; status: string; rotatedAt?: string }>> {
  try {
    assertNoOrganizationId(body);
    const token = await requireAccessToken();
    const view = await putPartnerConnection(token, partnerId, body);
    if ("outboundSecretRef" in (view as object)) {
      return { ok: false, status: 500, message: "Phản hồi kết nối lộ secretRef — đã chặn hiển thị." };
    }
    revalidatePath("/partners");
    return {
      ok: true,
      data: {
        endpointHost: view.endpointHost,
        status: view.status,
        ...(view.rotatedAt ? { rotatedAt: view.rotatedAt } : {}),
      },
    };
  } catch (error) {
    return fail(error, "Không lưu được kết nối đối tác");
  }
}
