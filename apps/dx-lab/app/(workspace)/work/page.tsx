// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { ApprovalInboxPreview } from "../../../components/h/approval-inbox-preview";
import { StatusBanner } from "../../../components/h/status-banner";
import { ApiError, getFileMetadata, getReceivingOptions, listApprovalInbox, listTradingDocuments } from "../../../lib/api-client/client";
import type { ApprovalTask, FileMetadata } from "../../../lib/api-client/openapi-types";
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
  const [inbox, receivingResult, inboundResult] = await Promise.all([
    loadInbox(token, actor.roles.includes("issue_approver")),
    listTradingDocuments(token, "receivings")
      .then((items) => ({ items, error: "" }))
      .catch((error: unknown) => ({ items: [] as Record<string, unknown>[],
        error: error instanceof ApiError ? `Không tải được phiếu nhận (${error.status}).`
          : "Không tải được phiếu nhận." })),
    getReceivingOptions(token)
      .then((data) => ({ messages: Array.isArray(data.messages) ? data.messages as {
        messageId: string; issuerInstanceId: string; sentQuantity: string;
        receivingStatus: string; sourceDocument: { id: string };
      }[] : [], error: "" }))
      .catch((error: unknown) => ({ messages: [],
        error: error instanceof ApiError ? `Không tải được thông báo nhận hàng (${error.status}).`
          : "Không tải được thông báo nhận hàng." })),
  ]);
  const fileIds = [...new Set(inbox.tasks.flatMap((task) => task.evidenceFileIds ?? []))].slice(0, 20);
  const files = new Map<string, FileMetadata | null>(await Promise.all(fileIds.map(async (id) =>
    [id, await getFileMetadata(token, id).catch(() => null)] as const,
  )));

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
        <h2>Phiếu nhận hàng</h2>
        {inboundResult.error ? <StatusBanner tone="warning">{inboundResult.error}</StatusBanner> : null}
        {inboundResult.messages.filter((item) => item.receivingStatus === "pending_receipt").length ? (
          <ul className="task-list">
            {inboundResult.messages.filter((item) => item.receivingStatus === "pending_receipt")
              .map((item) => <li key={item.messageId}>
                <Link href="/operations/receivings">Cần nhận từ {item.issuerInstanceId} ·
                  {" "}{item.sourceDocument.id.slice(0, 8)} · gửi {item.sentQuantity}</Link>
              </li>)}
          </ul>
        ) : !inboundResult.error
          ? <StatusBanner tone="info">Không có thông báo nhận hàng đang chờ.</StatusBanner>
          : null}
        {receivingResult.error ? <StatusBanner tone="error">{receivingResult.error}</StatusBanner> : null}
        {receivingResult.items.length ? (
          <ul className="task-list">
            {receivingResult.items.slice(0, 20).map((item) => (
              <li key={String(item.id)}>
                <Link href={`/operations/receivings?id=${encodeURIComponent(String(item.id))}`}>
                  {String(item.documentNumber ?? item.id)}
                </Link>
                {" · "}{String(item.status ?? "—")}
              </li>
            ))}
          </ul>
        ) : !receivingResult.error
          ? <StatusBanner tone="info">Chưa có phiếu nhận hàng được phép xem.</StatusBanner>
          : null}
      </section>

      <section className="panel">
        <h2>Hồ sơ / tệp liên quan</h2>
        {fileIds.length
          ? (
            <ul className="task-list">
              {fileIds.map((fileId) => {
                const file = files.get(fileId);
                return <li key={fileId}>
                  Evidence <code>{fileId}</code>{file?.scanState === "clean"
                    ? <> · {file.mimeType} · {file.sizeBytes} bytes · checksum {file.checksum}</>
                    : " · metadata chưa có quyền truy cập hoặc chưa clean"}
                </li>;
              })}
            </ul>
          )
          : (
            <StatusBanner tone="info">
              Chưa có tệp bằng chứng trên inbox.
            </StatusBanner>
          )}
      </section>
    </section>
  );
}
