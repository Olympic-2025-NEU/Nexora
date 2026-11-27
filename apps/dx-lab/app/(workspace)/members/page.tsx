// SPDX-License-Identifier: AGPL-3.0-only
import { forbidden } from "next/navigation";
import { MembersPanel } from "../../../components/h/members-panel";
import { StatusBanner } from "../../../components/h/status-banner";
import { ApiError, listMembers } from "../../../lib/api-client/client";
import type { Member } from "../../../lib/api-client/openapi-types";
import { requireAccessToken } from "../../../lib/auth/access-token";
import { currentActor } from "../../../lib/auth/current-actor";

async function loadMembers(token: string): Promise<{ members?: Member[]; error?: string }> {
  try {
    return { members: await listMembers(token) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) forbidden();
    return {
      error: error instanceof ApiError
        ? `Không tải được danh sách thành viên (${error.status}${error.code ? `: ${error.code}` : ""}).`
        : "Không tải được danh sách thành viên.",
    };
  }
}

export default async function MembersPage() {
  const actor = await currentActor();
  if (!actor.roles.includes("administrator")) forbidden();

  const token = await requireAccessToken();
  const loaded = await loadMembers(token);

  return (
    <section className="stack">
      <p className="eyebrow">H · Human</p>
      <h1>Thành viên tổ chức</h1>
      <p className="muted">
        Catalog không thuộc trang này. Mời / vô hiệu hóa đi qua API M01; Staff bị chặn ở page guard và backend.
      </p>
      {loaded.error ? <StatusBanner tone="error">{loaded.error}</StatusBanner> : null}
      {loaded.members ? <MembersPanel initialMembers={loaded.members} /> : null}
    </section>
  );
}
