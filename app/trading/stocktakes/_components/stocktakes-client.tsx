// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminApi } from "@/app/lib/admin-api";

type Entry = { warehouseId: string; productVariantId: string; batchId: string; countedQuantity: string; uomId: string };
type Line = Entry & { id: string; systemQuantity?: string; delta?: string; unit?: string; movementId: string | null };
type Stocktake = { id: string; documentNumber: string; status: string; version: number; note: string | null;
  totalVariance: string | null; lines: Line[] };
type Batch = { id: string; localCode: string; productVariantId: string;
  uoms: { id: string; name: string; isStockKeeping: boolean }[];
  balances: { warehouseId: string; indicativeBalance: string }[] };
type Options = { readAt: string; warehouses: { id: string; name: string }[]; batches: Batch[] };
const empty = (): Entry => ({ warehouseId: "", productVariantId: "", batchId: "", countedQuantity: "", uomId: "" });

export function StocktakesClient({ id, creating = false }: { id?: string; creating?: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<Stocktake[]>([]);
  const [selected, setSelected] = useState<Stocktake | null>(null);
  const [options, setOptions] = useState<Options>({ readAt: "", warehouses: [], batches: [] });
  const [entries, setEntries] = useState<Entry[]>([empty()]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await adminApi(id ? `/api/v1/stocktakes/${id}` : "/api/v1/stocktakes");
    if (!response.ok) throw new Error("Không tải được phiếu kiểm kê.");
    const body = await response.json();
    if (id) {
      const doc = body.data as Stocktake;
      setSelected(doc); setNote(doc.note ?? "");
      setEntries(doc.lines.map(({ warehouseId, batchId, productVariantId, countedQuantity, uomId }) => ({
        warehouseId, batchId, productVariantId, countedQuantity, uomId,
      })));
    } else setItems(body.data as Stocktake[]);
  }, [id]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void load().catch((err: Error) => setError(err.message)); });
    return () => { active = false; };
  }, [load]);
  useEffect(() => {
    if (!creating && !id) return;
    void adminApi("/api/v1/stocktakes?options=1").then(async (response) => {
      if (!response.ok) throw new Error("Không tải được lô và kho.");
      setOptions((await response.json()).data as Options);
    }).catch((err: Error) => setError(err.message));
  }, [creating, id]);
  function update(index: number, patch: Partial<Entry>) {
    setEntries((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await adminApi(id ? `/api/v1/stocktakes/${id}` : "/api/v1/stocktakes", {
        method: id ? "PATCH" : "POST",
        headers: { ...(id ? { "if-match": String(selected?.version) } : {}) },
        body: JSON.stringify({ lines: entries, note }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Không lưu được phiếu kiểm kê.");
      const doc = (await response.json()).data as Stocktake;
      if (id) await load(); else router.push(`/trading/stocktakes/${doc.id}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Lỗi lưu phiếu kiểm kê."); }
    finally { setBusy(false); }
  }
  async function act(action: "confirm" | "cancel") {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const response = await adminApi(`/api/v1/stocktakes/${selected.id}/${action}`, {
        method: "POST", headers: { "if-match": String(selected.version),
          ...(action === "confirm" ? { "idempotency-key": crypto.randomUUID() } : {}) }, body: "{}",
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Không cập nhật được phiếu kiểm kê.");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Lỗi xác nhận kiểm kê."); }
    finally { setBusy(false); }
  }
  const varianceLikely = entries.some((row) => {
    const batch = options.batches.find((item) => item.id === row.batchId);
    const system = batch?.balances.find((item) => item.warehouseId === row.warehouseId)?.indicativeBalance ?? "0";
    return row.countedQuantity !== "" && batch?.uoms.find((uom) => uom.id === row.uomId)?.isStockKeeping &&
      Number(row.countedQuantity) !== Number(system);
  });
  const editor = <form onSubmit={save} className="space-y-4 rounded border p-4">
    <p>Số dư chỉ tham khảo — confirm sẽ đọc lại balance. Đọc lúc {options.readAt || "đang tải"}.</p>
    {entries.map((row, index) => {
      const batch = options.batches.find((item) => item.id === row.batchId);
      const balance = batch?.balances.find((item) => item.warehouseId === row.warehouseId)?.indicativeBalance ?? "0.000";
      return <fieldset key={index} className="space-y-2 rounded border p-3">
        <legend>Dòng {index + 1}</legend>
        <label className="block">Kho<select className="block w-full border p-2" required value={row.warehouseId}
          onChange={(event) => update(index, { warehouseId: event.target.value })}>
          <option value="">Chọn kho</option>{options.warehouses.map((item) =>
            <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label className="block">Batch<select className="block w-full border p-2" required value={row.batchId}
          onChange={(event) => { const next = options.batches.find((item) => item.id === event.target.value);
            update(index, { batchId: event.target.value, productVariantId: next?.productVariantId ?? "",
              uomId: next?.uoms.find((item) => item.isStockKeeping)?.id ?? "" }); }}>
          <option value="">Chọn batch (kể cả batch chưa có tồn)</option>{options.batches.map((item) =>
            <option key={item.id} value={item.id}>{item.localCode} · {item.id}</option>)}
        </select></label>
        <p>Tồn hiện tại chỉ tham khảo: {balance} · đọc lúc {options.readAt || "đang tải"}</p>
        <label className="block">Đã đếm<input className="block w-full border p-2" required type="text" inputMode="decimal"
          value={row.countedQuantity} onChange={(event) => update(index, { countedQuantity: event.target.value })} /></label>
        <label className="block">Đơn vị<select className="block w-full border p-2" required value={row.uomId}
          onChange={(event) => update(index, { uomId: event.target.value })}>
          <option value="">Chọn đơn vị</option>{batch?.uoms.map((item) =>
            <option key={item.id} value={item.id}>{item.name} {item.isStockKeeping ? "· đơn vị tồn" : "· đóng gói"}</option>)}
        </select></label>
        {entries.length > 1 && <button type="button" className="underline" onClick={() =>
          setEntries((rows) => rows.filter((_, i) => i !== index))}>Xoá dòng</button>}
      </fieldset>;
    })}
    <button type="button" className="underline" onClick={() => setEntries((rows) => [...rows, empty()])}>Thêm dòng</button>
    <label className="block font-medium">Lý do chênh lệch (bắt buộc khi confirm có variance)
      <textarea className="block w-full border p-2 font-normal" maxLength={2000} value={note}
        onChange={(event) => setNote(event.target.value)} /></label>
    {varianceLikely && !note.trim() && <p role="status">Có chênh lệch ước tính. Nhập lý do trước khi confirm.</p>}
    <button type="submit" disabled={busy} className="rounded border p-2">{id ? "Lưu bản nháp" : "Tạo bản nháp"}</button>
  </form>;
  return <main className="mx-auto max-w-5xl space-y-6">
    <h1 className="text-2xl font-semibold">Kiểm kê theo lô</h1>
    <nav className="flex gap-4"><Link href="/trading/stocktakes">Kiểm kê</Link>
      <Link href="/trading/stocktakes/create">Tạo phiếu</Link><Link href="/orders">Đơn hàng</Link></nav>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {creating && editor}
    {!id && !creating && <ul className="space-y-2">{items.map((doc) => <li key={doc.id}>
      <Link className="underline" href={`/trading/stocktakes/${doc.id}`}>{doc.documentNumber}</Link>
      {" · "}{doc.status} · Tổng chênh tuyệt đối {doc.totalVariance ?? "chưa confirm"}
    </li>)}</ul>}
    {selected && <section className="space-y-3">
      <h2 className="text-xl font-medium">{selected.documentNumber} · {selected.status}</h2>
      {selected.status === "draft" ? editor : <>
        <p>Lý do: {selected.note || "Không chênh lệch"}</p>
        <table className="w-full text-left"><thead><tr><th>Batch / kho</th><th>Hệ thống</th><th>Đã đếm</th><th>Delta</th><th>Movement ID</th></tr></thead>
          <tbody>{selected.lines.map((line) => <tr key={line.id}>
            <td>{line.batchId} / {line.warehouseId}</td><td>{line.systemQuantity ?? "—"}</td>
            <td>{line.countedQuantity} {line.unit}</td><td>{line.delta ?? "—"}</td><td>{line.movementId ?? "Không điều chỉnh"}</td>
          </tr>)}</tbody></table>
      </>}
      {selected.status === "draft" && <div className="flex gap-4">
        <button disabled={busy || note !== (selected.note ?? "") || (varianceLikely && !selected.note?.trim())}
          onClick={() => void act("confirm")}>Xác nhận kiểm kê</button>
        <button disabled={busy} onClick={() => void act("cancel")}>Huỷ bản nháp</button>
      </div>}
    </section>}
  </main>;
}
