// SPDX-License-Identifier: AGPL-3.0-only
import { ApprovalsPanel } from "../../../../components/p/approvals-panel";
import { StatusBanner } from "../../../../components/h/status-banner";
import { ApiError, listApprovalInbox } from "../../../../lib/api-client/client";
import type { ApprovalTask } from "../../../../lib/api-client/openapi-types";
import { requireAccessToken } from "../../../../lib/auth/access-token";
import { currentActor } from "../../../../lib/auth/current-actor";

async function loadInbox(token: string): Promise<{ tasks?: ApprovalTask[]; error?: string }> {
  try {
    return { tasks: await listApprovalInbox(token) };
  } catch (error) {
    return {
      error: error instanceof ApiError
        ? `Không tải inbox (${error.status}${error.code ? `: ${error.code}` : ""}).`
        : "Không tải inbox phê duyệt.",
    };
  }
}

export default async function ApprovalsPage() {
  const actor = await currentActor();
  if (!actor.roles.includes("issue_approver")) {
    return (
      <section className="stack">
        <p className="eyebrow">P · Process</p>
        <h1>Hộp phê duyệt</h1>
        <StatusBanner tone="info">Chỉ issue_approver mới mở inbox quyết định.</StatusBanner>
      </section>
    );
  }
  const token = await requireAccessToken();
  const loaded = await loadInbox(token);

  return (
    <section className="stack">
      <p className="eyebrow">P · Process</p>
      <h1>Hộp phê duyệt</h1>
      {loaded.error ? <StatusBanner tone="error">{loaded.error}</StatusBanner> : null}
      {loaded.tasks ? <ApprovalsPanel initialTasks={loaded.tasks} /> : null}
    </section>
  );
}
