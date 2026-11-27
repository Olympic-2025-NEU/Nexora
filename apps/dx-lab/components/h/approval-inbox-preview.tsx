// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import type { ApprovalTask } from "../../lib/api-client/openapi-types";
import { StatusBanner } from "./status-banner";

export function ApprovalInboxPreview({
  tasks,
  denied,
  error,
}: {
  tasks: ApprovalTask[];
  denied: boolean;
  error?: string;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Hộp phê duyệt</h2>
        <Link href="/operations">Mở vùng P</Link>
      </div>
      {denied
        ? <StatusBanner tone="info">Chỉ vai trò Approver mới xem được inbox phê duyệt.</StatusBanner>
        : null}
      {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}
      {!denied && !error && !tasks.length
        ? <StatusBanner tone="info">Không có task đang chờ quyết định.</StatusBanner>
        : null}
      {!denied && tasks.length > 0 ? (
        <ul className="task-list">
          {tasks.slice(0, 8).map((task) => (
            <li key={task.approvalRequestId}>
              <strong>{task.documentNumber}</strong>
              <span className="muted">
                {" "}· {task.documentType} · {Math.floor(task.ageSeconds / 60)} phút · {task.approvalState}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="muted">Quyết định approve/reject đầy đủ thuộc P11-T04.</p>
    </section>
  );
}
