// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { adminApi } from "@/app/lib/admin-api";

type Queued = { messageId: string; state: "pending"; eventCount?: number;
  policyVersion?: number };
async function result(response: Response): Promise<Queued> {
  const body = await response.json() as { data?: Queued; error?: string };
  if (!response.ok || !body.data) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body.data;
}

/** Explicit admin action: policy approval lives in the passport policy panel. */
export function FederationShare() {
  const [admin, setAdmin] = useState(false);
  const [batchId, setBatchId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [inboxMessageId, setInboxMessageId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { void adminApi("/api/v1/me").then(async (response) => {
    if (!response.ok) return;
    const body = await response.json() as { roles?: string[] };
    setAdmin(Boolean(body.roles?.includes("administrator")));
  }).catch(() => {}); }, []);
  if (!admin) return null;
  async function queue(kind: "summary" | "impact", event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const path = kind === "summary" ? "federation-summary" : "downstream-impact";
      const payload = kind === "summary" ? { recipientInstanceId: recipient.trim() } : {
        recipientInstanceId: recipient.trim(), sourceDocumentId: documentId.trim(),
        ...(inboxMessageId.trim() ? { sourceInboxMessageId: inboxMessageId.trim() } : {}) };
      const queued = await result(await adminApi(
        `/api/v1/lots/${encodeURIComponent(batchId.trim())}/${path}`,
        { method: "POST", body: JSON.stringify(payload) }));
      setMessage(`Đã xếp hàng ${kind === "summary" ? "tóm tắt" : "impact"}: ${queued.messageId}` +
        (queued.eventCount ? ` · ${queued.eventCount} sự kiện` : ""));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Không gửi được."); }
    finally { setBusy(false); }
  }
  return <section className="mt-8 space-y-3 rounded border p-4" aria-label="Chia sẻ trace liên instance">
    <h2 className="text-xl font-semibold">Chia sẻ trace giữa các instance</h2>
    <p className="text-sm text-muted-foreground">Chỉ Administrator thực hiện. Hãy duyệt policy timeline
      cho lô ở mục Passport trước; partner chỉ chia sẻ trực tiếp, public cho phép chuyển tiếp.
      Bản đối tác được ghi partner_asserted và chỉ trở thành local verified tại nơi phát sinh.</p>
    <label className="flex flex-col gap-1 text-sm">ID lô local
      <input className="rounded border p-2" value={batchId} onChange={(event) =>
        setBatchId(event.target.value)} placeholder="UUID của lô" /></label>
    <label className="flex flex-col gap-1 text-sm">Issuer instance nhận
      <input className="rounded border p-2" value={recipient} onChange={(event) =>
        setRecipient(event.target.value)} placeholder="nexora-b / nexora-c" /></label>
    <form onSubmit={(event) => { void queue("summary", event); }}>
      <button type="submit" disabled={busy || !batchId.trim() || !recipient.trim()}
        className="rounded border px-4 py-2 disabled:opacity-50">Gửi tóm tắt nguồn gốc</button>
    </form>
    <form className="space-y-3 border-t pt-3" onSubmit={(event) => { void queue("impact", event); }}>
      <label className="flex flex-col gap-1 text-sm">ID sale/transfer đã xác nhận
        <input className="rounded border p-2" value={documentId} onChange={(event) =>
          setDocumentId(event.target.value)} placeholder="UUID của chứng từ" /></label>
      <label className="flex flex-col gap-1 text-sm">Message ID impact C đã nhận (chỉ B chuyển tiếp)
        <input className="rounded border p-2" value={inboxMessageId} onChange={(event) =>
          setInboxMessageId(event.target.value)} placeholder="Để trống khi phát từ sale" /></label>
      <button type="submit" disabled={busy || !batchId.trim() || !recipient.trim() || !documentId.trim()}
        className="rounded border px-4 py-2 disabled:opacity-50">Gửi tóm tắt tác động downstream</button>
    </form>
    {message && <p role="status" className="break-all text-sm">{message}</p>}
  </section>;
}
