// SPDX-License-Identifier: AGPL-3.0-only
import { OrganizationForm } from "../../../components/h/organization-form";
import { StatusBanner } from "../../../components/h/status-banner";
import { ApiError, getOrganization } from "../../../lib/api-client/client";
import type { Organization } from "../../../lib/api-client/openapi-types";
import { requireAccessToken } from "../../../lib/auth/access-token";
import { currentActor } from "../../../lib/auth/current-actor";

async function loadOrganization(token: string): Promise<{
  organization?: Organization;
  error?: string;
}> {
  try {
    return { organization: await getOrganization(token) };
  } catch (error) {
    return {
      error: error instanceof ApiError
        ? `Không tải được tổ chức (${error.status}${error.code ? `: ${error.code}` : ""}).`
        : "Không tải được tổ chức.",
    };
  }
}

export default async function ProfilePage() {
  const actor = await currentActor();
  const token = await requireAccessToken();
  const canEdit = actor.roles.includes("administrator");
  const loaded = await loadOrganization(token);

  return (
    <section className="stack">
      <p className="eyebrow">H · Human</p>
      <h1>Hồ sơ</h1>
      <dl className="profile panel">
        <dt>Tên hiển thị</dt><dd>{actor.displayName || "Chưa có"}</dd>
        <dt>Vai trò</dt><dd>{actor.roles.join(", ") || "—"}</dd>
        <dt>Tổ chức (từ session)</dt><dd>{actor.organizationId}</dd>
        <dt>Đơn vị</dt><dd>{actor.unitIds.length ? actor.unitIds.join(", ") : "—"}</dd>
      </dl>
      {loaded.error ? <StatusBanner tone="error">{loaded.error}</StatusBanner> : null}
      {loaded.organization
        ? <OrganizationForm organization={loaded.organization} canEdit={canEdit} />
        : !loaded.error
          ? <StatusBanner tone="info">Chưa có dữ liệu tổ chức.</StatusBanner>
          : null}
    </section>
  );
}
