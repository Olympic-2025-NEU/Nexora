// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { adminApi } from "@/app/lib/admin-api";
import Link from "next/link";

type Kind = "receipts" | "issues";
type Document = { id: string; documentNumber: string; status: string; version: number;
  createdAt: string; approval?: { state: string; lineHash: string; processInstanceId: string | null;
    processDefinitionVersion: number | null; history: { action: string; at: string;
      before: unknown; after: unknown }[] } | null; lines: { stockQuantity?: string; quantity: string;
    warehouseId: string; batchId: string; productVariantId: string; uomId: string;
    sources?: { sourceLineId: string; quantity: string }[] }[] };
type Batch = { id: string; productVariantId: string; localCode: string; expiresOn?: string };
type Variant = { id: string; label: string };
type Balance = { warehouseId: string; batchId: string; quantity: string };
type Uom = { uomId: string; factorToStockUom: string; isStockKeeping: boolean };
type IssueSourceOption = { sourceLineId: string; documentNumber: string;
  documentType: string; availableQuantity: string; uomId: string };

function scaled(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0").slice(0, 3));
}
function display(value: bigint) { return `${value / BigInt(1000)}.${String(value % BigInt(1000)).padStart(3, "0")}`; }

export function DocumentsClient({ kind, id }: { kind: Kind; id?: string }) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [issueSources, setIssueSources] = useState<IssueSourceOption[]>([]);
  const [sourceRows, setSourceRows] = useState<{ sourceLineId: string; quantity: string }[]>([]);
  const [nextSourceCursor, setNextSourceCursor] = useState<string | null>(null);
  const [variantId, setVariantId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [uomId, setUomId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [purpose, setPurpose] = useState<"other" | "sale" | "partner_transfer">("other");
  const [selected, setSelected] = useState<Document | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [list, products, lots, warehousesResult, stocks] = await Promise.all([
      adminApi(`/api/v1/${kind}`), adminApi("/api/v1/products?limit=50"),
      adminApi("/api/v1/batches?limit=100"), adminApi("/api/v1/warehouses?limit=100"),
      adminApi("/api/v1/inventory/balances?limit=100"),
    ]);
    if (![list, products, lots, warehousesResult, stocks].every((res) => res.ok)) {
      throw new Error("Không tải được dữ liệu chứng từ hoặc danh mục.");
    }
    setDocs(((await list.json()).data ?? []) as Document[]);
    const productsData = (await products.json()).data as { id: string; name: string }[];
    const variantPages = await Promise.all(productsData.map(async (product) => {
      const response = await adminApi(`/api/v1/products/${product.id}/variants`);
      if (!response.ok) return [];
      return ((await response.json()).data as { id: string; sku: string | null }[]).map((variant) => ({
        id: variant.id, label: `${product.name} · ${variant.sku ?? variant.id.slice(0, 8)}`,
      }));
    }));
    setVariants(variantPages.flat());
    setBatches(((await lots.json()).data ?? []) as Batch[]);
    setWarehouses(((await warehousesResult.json()).data ?? []) as { id: string; name: string }[]);
    setBalances(((await stocks.json()).data ?? []) as Balance[]);
  }, [kind]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void load().catch((err: Error) => setError(err.message)); });
    return () => { cancelled = true; };
  }, [load]);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void adminApi(`/api/v1/${kind}/${id}`).then(async (response) => {
      if (!response.ok) throw await responseError(response);
      if (!cancelled) setSelected((await response.json()).data as Document);
    }).catch((err: Error) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [id, kind]);
  useEffect(() => {
    if (!variantId) return;
    void adminApi(`/api/v1/variants/${variantId}/uoms`).then(async (response) => {
      if (!response.ok) throw new Error("Không tải được đơn vị tính.");
      const rows = ((await response.json()).data ?? []) as Uom[];
      setUoms(rows);
      setUomId(rows.find((row) => row.isStockKeeping)?.uomId ?? "");
    }).catch((err: Error) => setError(err.message));
  }, [variantId]);
  useEffect(() => {
    if (kind !== "issues" || !batchId || !warehouseId) return;
    let cancelled = false;
    void adminApi(`/api/v1/lots/${batchId}/issue-sources?warehouseId=${warehouseId}`)
      .then(async (response) => {
        if (!response.ok) throw await responseError(response);
        const body = await response.json() as { data: IssueSourceOption[];
          page: { nextCursor: string | null } };
        if (!cancelled) { setIssueSources(body.data); setNextSourceCursor(body.page.nextCursor); }
      }).catch((err: Error) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [kind, batchId, warehouseId]);

  async function moreSources() {
    if (!nextSourceCursor) return;
    try {
      const response = await adminApi(`/api/v1/lots/${batchId}/issue-sources?warehouseId=${warehouseId}&cursor=${nextSourceCursor}`);
      if (!response.ok) throw await responseError(response);
      const body = await response.json() as { data: IssueSourceOption[];
        page: { nextCursor: string | null } };
      setIssueSources((previous) => [...previous, ...body.data]);
      setNextSourceCursor(body.page.nextCursor);
    } catch (err) { setError(err instanceof Error ? err.message : "Không tải được nguồn nhập."); }
  }

  const balance = balances.find((row) => row.batchId === batchId && row.warehouseId === warehouseId)?.quantity ?? "0.000";
  const preview = selected?.status === "draft" && selected.lines[0]?.stockQuantity;
  const after = preview && selected.lines[0]?.batchId === batchId &&
    selected.lines[0]?.warehouseId === warehouseId
    ? display(scaled(balance) + (kind === "receipts" ? BigInt(1) : -BigInt(1)) * scaled(preview)) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const input = { lines: [{ warehouseId, productVariantId: variantId, batchId, quantity, uomId,
        ...(kind === "issues" && sourceRows.length ? { sources: sourceRows } : {}) }],
        ...(kind === "issues" ? { purpose } : {}) };
      const response = await adminApi(`/api/v1/${kind}`, { method: "POST", body: JSON.stringify(input) });
      if (!response.ok) throw await responseError(response);
      const doc = (await response.json()).data as Document;
      setSelected(doc);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Lỗi tạo chứng từ."); }
    finally { setBusy(false); }
  }

  async function act(action: "submit" | "confirm" | "cancel") {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const response = await adminApi(`/api/v1/${kind}/${selected.id}/${action}`, {
        method: "POST", headers: { "if-match": String(selected.version),
          ...(action === "confirm" ? { "idempotency-key": crypto.randomUUID() } : {}) },
        body: "{}",
      });
      if (!response.ok) throw await responseError(response);
      const detail = await adminApi(`/api/v1/${kind}/${selected.id}`);
      if (!detail.ok) throw await responseError(detail);
      setSelected((await detail.json()).data as Document);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Lỗi cập nhật chứng từ."); }
    finally { setBusy(false); }
  }

  async function select(id: string) {
    try {
      const response = await adminApi(`/api/v1/${kind}/${id}`);
      if (!response.ok) throw await responseError(response);
      setSelected((await response.json()).data as Document);
    } catch (err) { setError(err instanceof Error ? err.message : "Lỗi tải chứng từ."); }
  }

  return <main className="mx-auto max-w-5xl space-y-6">
    <h1 className="text-2xl font-semibold">{kind === "receipts" ? "Nhập kho" : "Xuất kho"}</h1>
    <nav className="flex gap-4"><Link href="/trading/receipts">Nhập kho</Link><Link href="/trading/issues">Xuất kho</Link>
      {kind === "issues" && <Link href="/trading/approvals">Hộp duyệt</Link>}</nav>
    <form onSubmit={submit} className="grid gap-3 rounded border p-4 sm:grid-cols-2">
      <label>Sản phẩm / biến thể<select className="w-full border p-2" value={variantId} required
        onChange={(event) => { setVariantId(event.target.value); setBatchId("");
          setIssueSources([]); setSourceRows([]); setNextSourceCursor(null); }}>
        <option value="">Chọn biến thể</option>{variants.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
      </select></label>
      <label>Lô hàng<select className="w-full border p-2" value={batchId} required onChange={(event) => {
        setBatchId(event.target.value); setIssueSources([]); setSourceRows([]); setNextSourceCursor(null);
      }}>
        <option value="">Chọn lô</option>{batches.filter((row) => row.productVariantId === variantId).map((row) =>
          <option key={row.id} value={row.id}>{row.localCode} · Hạn {row.expiresOn ?? "không có"} · Tồn {balances.filter((b) => b.batchId === row.id).map((b) => b.quantity).join(", ") || "0"}</option>)}
      </select></label>
      <label>Kho<select className="w-full border p-2" value={warehouseId} required onChange={(event) => {
        setWarehouseId(event.target.value); setIssueSources([]); setSourceRows([]); setNextSourceCursor(null);
      }}>
        <option value="">Chọn kho</option>{warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>
      <label>Số lượng<input className="w-full border p-2" required type="text" inputMode="decimal" value={quantity}
        onChange={(event) => setQuantity(event.target.value)} /></label>
      <label>Đơn vị tính<select className="w-full border p-2" value={uomId} required onChange={(event) => setUomId(event.target.value)}>
        {uoms.map((row) => <option key={row.uomId} value={row.uomId}>
          {row.isStockKeeping ? "Đơn vị tồn" : "Đơn vị đóng gói"} · {row.factorToStockUom} / đơn vị tồn
        </option>)}
      </select></label>
      {kind === "issues" && <label>Mục đích<select className="w-full border p-2" value={purpose}
        onChange={(event) => setPurpose(event.target.value as typeof purpose)}>
        <option value="other">Khác</option><option value="sale">Bán</option><option value="partner_transfer">Chuyển đối tác</option>
      </select></label>}
      {kind === "issues" && <section className="space-y-2 rounded border p-3 sm:col-span-2">
        <h2 className="font-semibold">Nguồn hàng xuất</h2>
        <p className="text-sm">Chọn dòng nhập đã xác nhận. Số lượng nguồn tính theo đơn vị tồn và phải bằng tổng lượng xuất đã quy đổi. Không chọn nguồn thì lịch sử sẽ ghi “chưa rõ phân bổ”.</p>
        {sourceRows.map((row, index) => <div key={index} className="flex flex-wrap gap-2">
          <select className="min-w-56 flex-1 border p-2" required value={row.sourceLineId}
            onChange={(event) => setSourceRows((previous) => previous.map((item, i) =>
              i === index ? { ...item, sourceLineId: event.target.value } : item))}>
            <option value="">Chọn dòng nguồn</option>
            {issueSources.filter((source) => source.uomId ===
              (uoms.find((unit) => unit.isStockKeeping)?.uomId ?? uomId))
              .map((source) => <option key={source.sourceLineId} value={source.sourceLineId}>
                {source.documentNumber} · còn {source.availableQuantity}
              </option>)}
          </select>
          <input className="w-36 border p-2" aria-label={`Số lượng nguồn ${index + 1}`}
            type="text" inputMode="decimal" required value={row.quantity}
            onChange={(event) => setSourceRows((previous) => previous.map((item, i) =>
              i === index ? { ...item, quantity: event.target.value } : item))} />
          <button type="button" onClick={() => setSourceRows((previous) =>
            previous.filter((_, i) => i !== index))}>Bỏ</button>
        </div>)}
        <div className="flex gap-3"><button type="button" disabled={!batchId || !warehouseId}
          onClick={() => setSourceRows((previous) => [...previous, { sourceLineId: "", quantity: "" }])}>Thêm nguồn</button>
          {nextSourceCursor && <button type="button" onClick={() => void moreSources()}>Tải thêm dòng nhập</button>}
        </div>
      </section>}
      <p>Tồn trước: {balance}. Số lượng quy đổi: {after ? preview : "Lưu bản nháp để xem"}. Tồn dự kiến: {after ?? "—"}</p>
      <button className="rounded bg-primary p-2 text-primary-foreground disabled:opacity-50" disabled={busy} type="submit">Tạo bản nháp</button>
    </form>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {selected && <section className="space-x-3 rounded border p-4">
      <strong>{selected.documentNumber}</strong> · {selected.status} · duyệt: {selected.approval?.state ?? "không yêu cầu"}
      {kind === "issues" && <div className="mt-2 text-sm">{selected.lines.map((line, index) =>
        <p key={index}>Dòng {index + 1}: {line.sources?.length
          ? line.sources.map((source) => `${source.sourceLineId} (${source.quantity})`).join("; ")
          : "chưa khai báo nguồn"}</p>)}</div>}
      {selected.status === "draft" && kind === "receipts" && <button disabled={busy} onClick={() => void act("confirm")}>Xác nhận</button>}
      {selected.status === "draft" && kind === "issues" && <button disabled={busy} onClick={() => void act("submit")}>Gửi duyệt</button>}
      {selected.status === "approved" && kind === "issues" && <button disabled={busy || selected.approval?.state !== "approved"}
        onClick={() => void act("confirm")}>Xác nhận xuất kho</button>}
      {["draft", "pending_approval", "approved"].includes(selected.status) && <button disabled={busy} onClick={() => void act("cancel")}>Huỷ</button>}
      <button onClick={() => void select(selected.id)}>Tải lại</button>
      {kind === "issues" && <section className="mt-4 space-y-2 border-t pt-3">
        <h2 className="font-semibold">Phê duyệt</h2>
        <p>Chứng từ: {selected.status} · Bridge: {selected.approval?.state ?? "chưa gửi"}</p>
        {["requested", "starting", "decision_pending"].includes(selected.approval?.state ?? "") &&
          <p role="status">Đang chờ workflow engine</p>}
        <p>Process instance: {selected.approval?.processInstanceId ?? "chưa có"} · Definition version: {selected.approval?.processDefinitionVersion ?? "chưa có"}</p>
        <p>Line hash: {selected.approval?.lineHash.slice(0, 12) ?? "—"}</p>
        <ul>{selected.approval?.history.map((entry, index) => <li key={`${entry.at}-${index}`}>
          {new Date(entry.at).toLocaleString("vi-VN")} · {entry.action === "workflow.approval.late_result_ignored"
            ? "Late result ignored (anomaly)" : entry.action} · {JSON.stringify(entry.before)} · {JSON.stringify(entry.after)}
        </li>)}</ul>
      </section>}
    </section>}
    <section><h2 className="text-lg font-semibold">Chứng từ</h2><ul className="space-y-2">
       {docs.map((doc) => <li key={doc.id}><button onClick={() => void select(doc.id)}>
         {doc.documentNumber} · {doc.status} · {new Date(doc.createdAt).toLocaleDateString("vi-VN")}
       </button>{kind === "issues" && <Link className="ml-3 underline" href={`/trading/issues/${doc.id}`}>Chi tiết</Link>}</li>)}
    </ul></section>
  </main>;
}

async function responseError(response: Response) {
  const body = await response.json() as { error?: string; details?: { requested: string; available: string } };
  if (response.status === 409) return new Error("Chứng từ đã thay đổi — tải lại. " + (body.error ?? ""));
  if (body.error === "INSUFFICIENT_STOCK" && body.details) {
    return new Error(`Thiếu tồn: cần ${body.details.requested}, có ${body.details.available}`);
  }
  return new Error(`${body.error ?? "Lỗi kiểm tra dữ liệu"} (${response.status})`);
}
