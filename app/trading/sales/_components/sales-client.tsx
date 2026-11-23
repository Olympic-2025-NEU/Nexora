// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminApi } from "@/app/lib/admin-api";

type Sale = { id: string; documentNumber: string; status: string; version: number; linkedIssueId: string;
  linkedIssueNumber: string; buyerRef: string | null; soldAt: string;
  lines: { id: string; sourceIssueLineId: string; batchId: string; quantity: string; uomId: string;
    stockEffect: { issueBefore: string; issueAfter: string } | null }[] };
type Options = { issues: { id: string; documentNumber: string;
  lines: { batchId: string; quantity: string; warehouseId: string }[] }[] };

export function SalesClient({ id, creating = false }: { id?: string; creating?: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<Sale[]>([]);
  const [selected, setSelected] = useState<Sale | null>(null);
  const [options, setOptions] = useState<Options>({ issues: [] });
  const [issueId, setIssueId] = useState("");
  const [buyerRef, setBuyerRef] = useState("");
  const [soldAt, setSoldAt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await adminApi(id ? `/api/v1/sales-records/${id}` : "/api/v1/sales-records");
    if (!response.ok) throw new Error("Không tải được bản ghi bán.");
    const body = await response.json();
    if (id) setSelected(body.data as Sale); else setItems(body.data as Sale[]);
  }, [id]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void load().catch((err: Error) => setError(err.message)); });
    return () => { active = false; };
  }, [load]);
  useEffect(() => {
    if (!creating) return;
    void adminApi("/api/v1/sales-records?options=1").then(async (response) => {
      if (!response.ok) throw new Error("Không tải được issue bán đã xác nhận.");
      setOptions((await response.json()).data as Options);
    }).catch((err: Error) => setError(err.message));
  }, [creating]);
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await adminApi("/api/v1/sales-records", { method: "POST",
        body: JSON.stringify({ linkedIssueId: issueId,
          ...(buyerRef.trim() ? { buyerRef: buyerRef.trim() } : {}),
          ...(soldAt ? { soldAt: new Date(soldAt).toISOString() } : {}) }) });
      if (!response.ok) throw new Error((await response.json()).error ?? "Không tạo được bản ghi bán.");
      const doc = (await response.json()).data as Sale;
      router.push(`/trading/sales/${doc.id}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Lỗi tạo bản ghi bán."); }
    finally { setBusy(false); }
  }
  async function act(action: "confirm" | "cancel") {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const response = await adminApi(`/api/v1/sales-records/${selected.id}/${action}`, { method: "POST",
        headers: { "if-match": String(selected.version),
          ...(action === "confirm" ? { "idempotency-key": crypto.randomUUID() } : {}) }, body: "{}" });
      if (!response.ok) throw new Error((await response.json()).error ?? "Không cập nhật được bản ghi bán.");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Lỗi xác nhận bán."); }
    finally { setBusy(false); }
  }
  const issue = options.issues.find((item) => item.id === issueId);
  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <h1 className="text-2xl font-semibold">Ghi nhận bán theo lô</h1>
    <nav className="flex gap-4"><Link href="/trading/issues">Issue</Link>
      <Link href="/trading/sales">Bán</Link><Link href="/trading/sales/create">Tạo bản ghi bán</Link></nav>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {creating && <form className="space-y-4 rounded border p-4" onSubmit={create}>
      <label className="block">Issue đã confirmed (purpose sale, chưa gắn sale active)
        <select className="block w-full border p-2" required value={issueId} onChange={(event) => setIssueId(event.target.value)}>
          <option value="">Chọn issue</option>{options.issues.map((item) =>
            <option key={item.id} value={item.id}>{item.documentNumber} · {item.id}</option>)}
        </select></label>
      <p>Lines do server copy nguyên trạng từ issue:</p>
      <ul>{issue?.lines.map((line, index) => <li key={index}>{line.batchId} · {line.quantity} · kho {line.warehouseId}</li>)}</ul>
      <label className="block">Buyer ref (mã tham chiếu ngoài, không nhập tên, số điện thoại hoặc thông tin thanh toán)
        <input className="block w-full border p-2" maxLength={64} value={buyerRef}
          onChange={(event) => setBuyerRef(event.target.value)} /></label>
      <label className="block">Thời điểm bán (để trống = thời điểm server tạo)
        <input className="block w-full border p-2" type="datetime-local" value={soldAt}
          onChange={(event) => setSoldAt(event.target.value)} /></label>
      <button className="rounded border p-2" disabled={busy} type="submit">Tạo bản nháp</button>
    </form>}
    {!creating && !id && <ul className="space-y-2">{items.map((doc) => <li key={doc.id}>
      <Link className="underline" href={`/trading/sales/${doc.id}`}>{doc.documentNumber}</Link>
      {" · "}{doc.status} · issue {doc.linkedIssueNumber ?? doc.linkedIssueId} · {doc.soldAt}
    </li>)}</ul>}
    {selected && <section className="space-y-3 rounded border p-4">
      <h2 className="text-xl font-medium">{selected.documentNumber} · {selected.status}</h2>
      <p>Issue nguồn: <Link className="underline" href="/trading/issues">{selected.linkedIssueNumber}</Link> · {selected.linkedIssueId}</p>
      <p>Thời điểm bán: {selected.soldAt} · buyer_ref (mã tham chiếu ngoài): {selected.buyerRef ?? "—"}</p>
      <ul>{selected.lines.map((line) => <li key={line.id} className="rounded border p-3">
        Batch {line.batchId} · {line.quantity} · UOM {line.uomId} · issue line {line.sourceIssueLineId}
        <p>Hiệu ứng tồn: issue: {line.stockEffect?.issueBefore ?? "—"} → {line.stockEffect?.issueAfter ?? "—"};
          sale: {line.stockEffect?.issueAfter ?? "—"} → {line.stockEffect?.issueAfter ?? "—"} — sale không trừ tồn.</p>
      </li>)}</ul>
      {selected.status === "draft" && <div className="flex gap-4">
        <button disabled={busy} onClick={() => void act("confirm")}>Confirm sale</button>
        <button disabled={busy} onClick={() => void act("cancel")}>Huỷ bản nháp</button>
      </div>}
    </section>}
  </main>;
}
