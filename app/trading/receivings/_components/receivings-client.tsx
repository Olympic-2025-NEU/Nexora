// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminApi } from "@/app/lib/admin-api";

type Lot = { sourceLineId: string; quantity: string; unit: "EA" | "KG" | "L";
  product: { productId: string }; senderBatch: { batchId: string } };
type Message = { messageId: string; issuerInstanceId: string;
  sourceDocument: { id: string }; lots: Lot[] };
type BatchOption = { id: string; localCode: string; productVariantId: string };
type Receiving = { id: string; documentNumber: string; status: string; version: number;
  inboundMessageId: string; sourceIssuerInstanceId: string; sourceTransferId: string;
  sentQuantity: string; actualQuantity: string; discrepancyQuantity: string; discrepancyReason: string | null;
  events: { internal: { eventType: string; status: string } | null;
    reply: { eventType: string; status: string; attempts: number; messageId: string } | null };
  lines: { id: string; sourceLineId: string; batchId: string; warehouseId: string;
    productId: string; sentQuantity: string; actualQuantity: string }[] };
type Entry = { sourceLineId: string; actualQuantity: string; localBatchId: string; warehouseId: string; unit: Lot["unit"] };
type Options = { source: "seeded"; messages: Message[]; warehouses: { id: string; name: string }[] };

export function ReceivingsClient({ id, creating = false }: { id?: string; creating?: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<Receiving[]>([]);
  const [selected, setSelected] = useState<Receiving | null>(null);
  const [options, setOptions] = useState<Options>({ source: "seeded", messages: [], warehouses: [] });
  const [messageId, setMessageId] = useState("");
  const [batches, setBatches] = useState<Record<string, BatchOption[]>>({});
  const [entries, setEntries] = useState<Entry[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const message = options.messages.find((item) => item.messageId === messageId);
  const differs = message?.lots.some((lot) => entries.find((row) => row.sourceLineId === lot.sourceLineId)?.actualQuantity !== "" &&
    Number(entries.find((row) => row.sourceLineId === lot.sourceLineId)?.actualQuantity) !== Number(lot.quantity)) ?? false;
  const sentTotal = message?.lots.reduce((sum, lot) => sum + Number(lot.quantity), 0) ?? 0;
  const actualTotal = entries.reduce((sum, row) => sum + Number(row.actualQuantity || 0), 0);
  const load = useCallback(async () => {
    const response = await adminApi(id ? `/api/v1/receivings/${id}` : "/api/v1/receivings");
    if (!response.ok) throw new Error("Không tải được phiếu nhận hàng.");
    const body = await response.json();
    if (id) {
      const received = body.data as Receiving;
      setSelected(received);
      setMessageId(received.inboundMessageId);
      setReason(received.discrepancyReason ?? "");
      setEntries(received.lines.map((line) => ({ sourceLineId: line.sourceLineId,
        actualQuantity: line.actualQuantity, localBatchId: line.batchId, warehouseId: line.warehouseId,
        unit: "EA" })));
    } else setItems(body.data as Receiving[]);
  }, [id]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void load().catch((err: Error) => setError(err.message)); });
    return () => { active = false; };
  }, [load]);
  useEffect(() => {
    if (!creating && !id) return;
    void adminApi("/api/v1/receivings?options=1").then(async (response) => {
      if (!response.ok) throw new Error("Không tải được nguồn seeded.");
      setOptions((await response.json()).data as Options);
    }).catch((err: Error) => setError(err.message));
  }, [creating, id]);
  useEffect(() => {
    if (!messageId) return;
    let active = true;
    void adminApi(`/api/v1/receivings?batchesFor=${encodeURIComponent(messageId)}`).then(async (response) => {
      if (!response.ok) throw new Error("Không tải được batch theo product và origin.");
      const rows = (await response.json()).data as { sourceLineId: string; batches: BatchOption[] }[];
      if (active) setBatches(Object.fromEntries(rows.map((row) => [row.sourceLineId, row.batches])));
    }).catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [messageId]);
  function selectMessage(value: string) {
    setMessageId(value); setReason(""); setBatches({});
    setEntries((options.messages.find((row) => row.messageId === value)?.lots ?? []).map((lot) => ({
      sourceLineId: lot.sourceLineId, actualQuantity: "", localBatchId: "", warehouseId: "", unit: lot.unit,
    })));
  }
  function change(sourceLineId: string, field: keyof Entry, value: string) {
    setEntries((current) => current.map((row) => row.sourceLineId === sourceLineId ? { ...row, [field]: value } : row));
  }
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await adminApi("/api/v1/receivings", { method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ inboundMessageId: messageId, actualLines: entries,
          ...(reason.trim() ? { discrepancyReason: reason.trim() } : {}) }) });
      if (!response.ok) throw new Error((await response.json()).error ?? "Không tạo được phiếu nhận.");
      const created = (await response.json()).data as Receiving;
      router.push(`/trading/receivings/${created.id}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Lỗi tạo phiếu nhận."); }
    finally { setBusy(false); }
  }
  async function act(action: "update" | "confirm" | "cancel") {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const response = await adminApi(`/api/v1/receivings/${selected.id}${action === "update" ? "" : `/${action}`}`, {
        method: action === "update" ? "PATCH" : "POST",
        headers: { "if-match": String(selected.version),
          ...(action === "confirm" ? { "idempotency-key": crypto.randomUUID() } : {}) },
        body: JSON.stringify(action === "update" ? {
          actualLines: entries.map(({ sourceLineId, actualQuantity, localBatchId, warehouseId }) => ({
            sourceLineId, actualQuantity, localBatchId, warehouseId })), discrepancyReason: reason,
        } : {}) });
      if (!response.ok) throw new Error((await response.json()).error ?? "Không cập nhật được phiếu nhận.");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Lỗi cập nhật phiếu nhận."); }
    finally { setBusy(false); }
  }
  const input = (row: Entry, lot: Lot) => <div key={row.sourceLineId} className="space-y-2 rounded border p-3">
    <p>Transfer line {row.sourceLineId} · product {lot.product.productId}</p>
    <p>Sender batch {lot.senderBatch.batchId} · sent <strong>{lot.quantity} {lot.unit}</strong></p>
    <label className="block">Actual counted ({lot.unit}) <input className="block w-full border p-2" type="number" min="0"
      max={lot.quantity} step={lot.unit === "EA" ? "1" : "0.001"} required value={row.actualQuantity}
      onChange={(event) => change(row.sourceLineId, "actualQuantity", event.target.value)} /></label>
    {creating && <button type="button" className="underline" onClick={() => change(row.sourceLineId, "actualQuantity", lot.quantity)}>
      Điền = sent (chủ động)</button>}
    <p>Delta: {row.actualQuantity === "" ? "chưa đếm" : (Number(lot.quantity) - Number(row.actualQuantity)).toFixed(3)}</p>
    <label className="block">Local batch (server lọc theo product + origin)
      <select className="block w-full border p-2" required value={row.localBatchId}
        onChange={(event) => change(row.sourceLineId, "localBatchId", event.target.value)}>
        <option value="">Chọn batch</option>{(batches[row.sourceLineId] ?? []).map((batch) =>
          <option key={batch.id} value={batch.id}>{batch.localCode} · {batch.id}</option>)}
        {!creating && row.localBatchId && !(batches[row.sourceLineId] ?? []).some((batch) => batch.id === row.localBatchId) &&
          <option value={row.localBatchId}>{row.localBatchId}</option>}
      </select></label>
    <label className="block">Warehouse<select className="block w-full border p-2" required value={row.warehouseId}
      onChange={(event) => change(row.sourceLineId, "warehouseId", event.target.value)}>
      <option value="">Chọn kho</option>{options.warehouses.map((warehouse) =>
        <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
    </select></label>
  </div>;
  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <h1 className="text-2xl font-semibold">Xác nhận nhận hàng đối tác</h1>
    <nav className="flex gap-4"><Link href="/trading/transfers">Transfers</Link>
      <Link href="/trading/receivings">Receivings</Link><Link href="/trading/receivings/create">Tạo receiving</Link></nav>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {creating && <form className="space-y-4" onSubmit={create}>
      <p>Nguồn: seeded inbound announcement. Chưa xác thực chữ ký đối tác.</p>
      <label className="block">Announcement từ seeded inbox
        <select className="block w-full border p-2" required value={messageId}
          onChange={(event) => selectMessage(event.target.value)}>
          <option value="">Chọn message</option>{options.messages.map((item) => <option key={item.messageId} value={item.messageId}>
            {item.issuerInstanceId} · transfer {item.sourceDocument.id} · message {item.messageId}</option>)}
        </select></label>
      {message?.lots.map((lot) => input(entries.find((row) => row.sourceLineId === lot.sourceLineId)!, lot))}
      {message && <><p>Sent {sentTotal} · Actual đã đếm {actualTotal} · Chênh {sentTotal - actualTotal}</p>
        {differs && <label className="block">Lý do chênh lệch
          <textarea className="block w-full border p-2" required maxLength={1000} value={reason}
            onChange={(event) => setReason(event.target.value)} /></label>}
        <button className="rounded border p-2" type="submit" disabled={busy || entries.some((row) => row.actualQuantity === "")}>Tạo Draft</button></>}
    </form>}
    {!creating && !id && <ul className="space-y-2">{items.map((row) => <li key={row.id}>
      <Link className="underline" href={`/trading/receivings/${row.id}`}>{row.documentNumber}</Link> · {row.status} ·
      {row.sourceIssuerInstanceId} / {row.sourceTransferId} · sent {row.sentQuantity} · actual {row.actualQuantity} ·
      discrepancy {row.discrepancyQuantity}
    </li>)}</ul>}
    {selected && <section className="space-y-4 rounded border p-4">
      <h2 className="text-xl font-medium">{selected.documentNumber} · {selected.status}</h2>
      <p>Source: {selected.sourceIssuerInstanceId} / transfer {selected.sourceTransferId} / seeded message {selected.inboundMessageId} / receiving {selected.id}</p>
      <p>Sent {selected.sentQuantity} · Actual {selected.actualQuantity} · Delta {selected.discrepancyQuantity}</p>
      {selected.status === "draft" ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void act("update"); }}>
        {selected.lines.map((line) => input(entries.find((row) => row.sourceLineId === line.sourceLineId)!,
          message?.lots.find((lot) => lot.sourceLineId === line.sourceLineId) ?? {
          sourceLineId: line.sourceLineId, quantity: line.sentQuantity, unit: "EA",
          product: { productId: line.productId }, senderBatch: { batchId: "Xem nguồn seeded" },
        }))}
        <label className="block">Lý do chênh lệch
          <textarea className="block w-full border p-2" maxLength={1000} required={selected.lines.some((line) =>
            Number(entries.find((row) => row.sourceLineId === line.sourceLineId)?.actualQuantity) !== Number(line.sentQuantity))}
            value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <button type="submit" disabled={busy}>Lưu số lượng / mapping</button>
      </form> : <ul>{selected.lines.map((line) => <li key={line.id}>
        {line.sourceLineId} · sent {line.sentQuantity} · actual {line.actualQuantity} · delta
        {(Number(line.sentQuantity) - Number(line.actualQuantity)).toFixed(3)} · batch {line.batchId} · receiving line {line.id}
      </li>)}</ul>}
      {selected.status === "draft" && <div className="flex gap-4">
        <button disabled={busy || (Number(selected.discrepancyQuantity) !== 0 && !selected.discrepancyReason?.trim())}
          onClick={() => void act("confirm")}>Confirm actual</button>
        <button disabled={busy} onClick={() => void act("cancel")}>Huỷ Draft</button>
      </div>}
      {selected.status === "confirmed" && <div className="space-y-2">
        <h3 className="font-medium">Events</h3>
        <p>Internal: {selected.events.internal?.eventType} · {selected.events.internal?.status}</p>
        <p>Federation business reply: {selected.events.reply?.eventType} · {selected.events.reply?.status} · attempts {selected.events.reply?.attempts} · message {selected.events.reply?.messageId}</p>
        <p>business confirmation — technical ACK: none</p>
      </div>}
    </section>}
  </main>;
}
