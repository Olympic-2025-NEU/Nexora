// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminApi } from "@/app/lib/admin-api";

type Transfer = { id: string; documentNumber: string; status: string; version: number; deliveryState: string;
  linkedIssueId: string; linkedIssueNumber?: string; destinationPartnerId: string; recipientInstanceId?: string;
  lines: { id: string; sourceIssueLineId: string; batchId: string; productId: string; quantity: string; uomId: string }[];
  announcement: { messageId: string; status: string; attempts: number; nextAttemptAt: string; lastError: string | null } | null };
type Options = { issues: { id: string; documentNumber: string }[];
  partners: { id: string; displayName: string; issuerInstanceId: string }[] };

export function TransfersClient({ id, creating = false }: { id?: string; creating?: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<Transfer[]>([]);
  const [selected, setSelected] = useState<Transfer | null>(null);
  const [options, setOptions] = useState<Options>({ issues: [], partners: [] });
  const [issueId, setIssueId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [issueLines, setIssueLines] = useState<{ id: string; batchId: string; quantity: string }[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await adminApi(id ? `/api/v1/transfers/${id}` : "/api/v1/transfers");
    if (!response.ok) throw new Error("Không tải được chứng từ chuyển đối tác.");
    const body = await response.json();
    if (id) setSelected(body.data as Transfer);
    else setItems(body.data as Transfer[]);
  }, [id]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void load().catch((err: Error) => setError(err.message)); });
    return () => { cancelled = true; };
  }, [load]);
  useEffect(() => {
    if (!creating) return;
    void adminApi("/api/v1/transfers?options=1").then(async (response) => {
      if (!response.ok) throw new Error("Không tải được issue/partner đủ điều kiện.");
      setOptions((await response.json()).data as Options);
    }).catch((err: Error) => setError(err.message));
  }, [creating]);
  useEffect(() => {
    if (!issueId) return;
    void adminApi(`/api/v1/issues/${issueId}`).then(async (response) => {
      if (!response.ok) throw new Error("Không tải được lines của issue.");
      setIssueLines((await response.json()).data.lines);
    }).catch((err: Error) => setError(err.message));
  }, [issueId]);
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await adminApi("/api/v1/transfers", { method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ linkedIssueId: issueId, destinationPartnerId: partnerId, note }) });
      if (!response.ok) throw new Error((await response.json()).error ?? "Không tạo được transfer.");
      const transfer = (await response.json()).data as Transfer;
      router.push(`/trading/transfers/${transfer.id}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Lỗi tạo chứng từ."); }
    finally { setBusy(false); }
  }
  async function act(action: "confirm" | "cancel") {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const response = await adminApi(`/api/v1/transfers/${selected.id}/${action}`, { method: "POST",
        headers: { "if-match": String(selected.version), ...(action === "confirm" ? { "idempotency-key": crypto.randomUUID() } : {}) },
        body: "{}" });
      if (!response.ok) throw new Error((await response.json()).error ?? "Không cập nhật được chứng từ.");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Lỗi xác nhận."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <h1 className="text-2xl font-semibold">Chuyển hàng cho đối tác</h1>
    <nav className="flex gap-4"><Link href="/trading/issues">Issue</Link><Link href="/trading/transfers">Transfers</Link>
      <Link href="/trading/transfers/create">Tạo transfer</Link></nav>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {creating && <form className="space-y-4 rounded border p-4" onSubmit={create}>
      <label className="block">Issue đã confirmed, chưa chuyển
        <select className="block w-full border p-2" required value={issueId} onChange={(event) => setIssueId(event.target.value)}>
          <option value="">Chọn issue</option>{options.issues.map((row) =>
            <option key={row.id} value={row.id}>{row.documentNumber} · {row.id}</option>)}
        </select></label>
      <label className="block">Đối tác federation active
        <select className="block w-full border p-2" required value={partnerId} onChange={(event) => setPartnerId(event.target.value)}>
          <option value="">Chọn đối tác</option>{options.partners.map((row) =>
            <option key={row.id} value={row.id}>{row.displayName} · {row.issuerInstanceId}</option>)}
        </select></label>
      <label className="block">Ghi chú<input className="block w-full border p-2" maxLength={2000} value={note}
        onChange={(event) => setNote(event.target.value)} /></label>
      <p>Lines được copy nguyên trạng từ issue. Không thể sửa sau khi tạo.</p>
      <ul>{issueLines.map((line) => <li key={line.id}>{line.batchId} · {line.quantity} · source {line.id}</li>)}</ul>
      <button type="submit" disabled={busy} className="rounded border p-2">Tạo bản nháp</button>
    </form>}
    {!creating && !id && <ul className="space-y-2">{items.map((row) => <li key={row.id}>
      <Link href={`/trading/transfers/${row.id}`} className="underline">{row.documentNumber}</Link> · {row.status} ·
      <span className="rounded border px-2">{row.deliveryState}</span>
    </li>)}</ul>}
    {selected && <section className="space-y-4 rounded border p-4">
      <h2 className="text-xl font-medium">{selected.documentNumber} · {selected.status}</h2>
      <p>Transfer: {selected.id}</p><p>Issue: {selected.linkedIssueNumber} · {selected.linkedIssueId}</p>
      <p>Partner: {selected.destinationPartnerId} · {selected.recipientInstanceId}</p>
      <p>Delivery: <span className="rounded border px-2">{selected.deliveryState}</span></p>
      <p>technical_ack / awaiting_receipt / received / partial / disputed: chờ federation (Phase 08/09).</p>
      <ul>{selected.lines.map((line) => <li key={line.id}>
        {line.batchId} · {line.productId} · {line.quantity} · UOM {line.uomId} · transfer line {line.id} · issue line {line.sourceIssueLineId}
      </li>)}</ul>
      <h3 className="font-medium">Announcement (read-only)</h3>
      {selected.announcement ? <dl>
        <dt>Message ID</dt><dd>{selected.announcement.messageId}</dd>
        <dt>Outbox status</dt><dd>{selected.announcement.status}</dd>
        <dt>Attempts</dt><dd>{selected.announcement.attempts}</dd>
        <dt>Next attempt</dt><dd>{selected.announcement.nextAttemptAt}</dd>
        <dt>Last error</dt><dd>{selected.announcement.lastError ?? "—"}</dd>
      </dl> : <p>Chưa confirm.</p>}
      {selected.status === "draft" && <div className="flex gap-4">
        <button disabled={busy} onClick={() => void act("confirm")}>Confirm</button>
        <button disabled={busy} onClick={() => void act("cancel")}>Huỷ</button>
      </div>}
    </section>}
  </main>;
}
