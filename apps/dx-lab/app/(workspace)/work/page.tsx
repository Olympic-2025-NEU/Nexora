// SPDX-License-Identifier: AGPL-3.0-only
import { ApprovalInboxPreview } from "../../../components/h/approval-inbox-preview";
import { StatusBanner } from "../../../components/h/status-banner";
import { ApiError, listApprovalInbox } from "../../../lib/api-client/client";
import type { ApprovalTask } from "../../../lib/api-client/openapi-types";
import { requireAccessToken } from "../../../lib/auth/access-token";
import { currentActor } from "../../../lib/auth/current-actor";

async function loadInbox(token: string, isApprover: boolean): Promise<{
  tasks: ApprovalTask[];
  denied: boolean;
  error?: string;
}> {
  if (!isApprover) return { tasks: [], denied: true };
  try {
    return { tasks: await listApprovalInbox(token), denied: false };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return { tasks: [], denied: true };
    }
    return {
      tasks: [],
      denied: false,
      error: error instanceof ApiError
        ? `Không tải được inbox (${error.status}${error.code ? `: ${error.code}` : ""}).`
        : "Không tải được inbox phê duyệt.",
    };
  }
}

export default async function WorkPage() {
  const actor = await currentActor();
  const token = await requireAccessToken();
  const inbox = await loadInbox(token, actor.roles.includes("approver"));

  return (
    <section className="stack">
      <p className="eyebrow">H · Human</p>
      <h1>Công việc của tôi</h1>
      <p>
        Xin chào {actor.displayName || "thành viên"}. Tổ chức phiên hiện tại:
        {" "}<code>{actor.organizationId}</code>. Tenant lấy từ actor — không gửi organizationId trong request.
      </p>

      <ApprovalInboxPreview tasks={inbox.tasks} denied={inbox.denied} error={inbox.error} />

      <section className="panel">
        <h2>Hồ sơ / tệp liên quan</h2>
        {inbox.tasks.some((task) => (task.evidenceFileIds ?? []).length > 0)
          ? (
            <ul className="task-list">
              {inbox.tasks.flatMap((task) =>
                (task.evidenceFileIds ?? []).map((fileId) => (
                  <li key={`${task.approvalRequestId}-${fileId}`}>
                    Evidence <code>{fileId}</code> · metadata qua Core File API (không raw payload).
                  </li>
                )))}
            </ul>
          )
          : (
            <StatusBanner tone="info">
              Chưa có evidenceFileIds trên inbox. Khi có, DX-Lab gọi
              {" "}<code>GET /api/v1/files/{"{id}"}</code> và chỉ hiện metadata clean.
            </StatusBanner>
          )}
      </section>
    </section>
  );
}
