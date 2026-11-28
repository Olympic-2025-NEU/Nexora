// SPDX-License-Identifier: AGPL-3.0-only
import { PartnersPanel } from "../../../components/h/partners-panel";
import { StatusBanner } from "../../../components/h/status-banner";
import {
  ApiError,
  getPartnerConnection,
  listPartners,
} from "../../../lib/api-client/client";
import type { Partner, PartnerConnectionView } from "../../../lib/api-client/openapi-types";
import { requireAccessToken } from "../../../lib/auth/access-token";
import { currentActor } from "../../../lib/auth/current-actor";

async function loadPartners(token: string): Promise<{
  partners?: Partner[];
  connections?: Record<string, PartnerConnectionView | null>;
  error?: string;
}> {
  try {
    const partners = await listPartners(token);
    const connections: Record<string, PartnerConnectionView | null> = {};
    await Promise.all(partners.map(async (partner) => {
      try {
        connections[partner.id] = await getPartnerConnection(token, partner.id);
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          connections[partner.id] = null;
          return;
        }
        throw error;
      }
    }));
    return { partners, connections };
  } catch (error) {
    return {
      error: error instanceof ApiError
        ? `Không tải được danh sách đối tác (${error.status}${error.code ? `: ${error.code}` : ""}).`
        : "Không tải được danh sách đối tác.",
    };
  }
}

export default async function PartnersPage() {
  const actor = await currentActor();
  const canManage = actor.roles.includes("administrator");
  const token = await requireAccessToken();
  const loaded = await loadPartners(token);

  return (
    <section className="stack">
      <p className="eyebrow">H · Human</p>
      <h1>Đối tác</h1>
      <p className="muted">
        Chọn đối tác rồi chuyển sang vùng P qua liên kết handoff (partnerId). Không gửi organizationId trong body.
      </p>
      {loaded.error ? <StatusBanner tone="error">{loaded.error}</StatusBanner> : null}
      {loaded.partners && loaded.connections ? (
        <PartnersPanel
          initialPartners={loaded.partners}
          connections={loaded.connections}
          canManage={canManage}
        />
      ) : null}
    </section>
  );
}
