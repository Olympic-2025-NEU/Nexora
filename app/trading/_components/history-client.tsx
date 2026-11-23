// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { adminApi } from "@/app/lib/admin-api";

type Item = { id: string; documentType: string; documentNumber: string; status: string; version: number;
  createdBySub: string; createdAt: string; confirmedAt: string | null;
  linkedIssueId?: string; destinationPartnerId?: string; deliveryState?: string;
  sourceIssuerInstanceId?: string; sourceTransferId?: string };
type Detail = Item & { note: string | null; lines: { id: string; lineNo: number; warehouseId: string;
    batchId: string; quantity: string | null; actualQuantity: string | null; countedQuantity: string | null }[];
  movements: { id: string; lineId: string; kind: string; delta: string; balanceAfter: string; createdAt: string }[];
  approval: { id: string; state: string; processInstanceId: string | null } | null;
  delivery?: { state: string; technicalAckAt: string | null; businessReceiptAt: string | null } };

const typeOptions = [
  ["", "Tất cả loại"], ["goods_receipt", "Nhập kho"], ["goods_issue", "Xuất kho"],
  ["partner_transfer", "Chuyển đối tác"], ["receiving_confirmation", "Xác nhận nhận hàng"],
  ["stocktake", "Kiểm kê"], ["sale_record", "Ghi nhận bán"],
] as const;
const statusOptions = ["", "draft", "pending_approval", "approved", "confirmed", "cancelled", "rejected"];

export function HistoryClient({ id }: { id?: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [batchId, setBatchId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (id) {
      const response = await adminApi(`/api/v1/documents/${id}`);
      if (!response.ok) throw new Error("Không tải được chi tiết chứng từ.");
      setDetail((await response.json()).data as Detail);
      return;
    }
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (status) params.set("status", status);
    if (batchId) params.set("batchId", batchId);
    if (partnerId) params.set("partnerId", partnerId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const response = await adminApi(`/api/v1/documents?${params.toString()}`);
    if (!response.ok) throw new Error("Không tải được lịch sử chứng từ.");
    setItems(((await response.json()).data ?? []) as Item[]);
  }, [id, type, status, batchId, partnerId, from, to]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void load().catch((err: Error) => setError(err.message)); });
    return () => { cancelled = true; };
  }, [load]);

  const apply = (event: FormEvent) => { event.preventDefault(); void load().catch((err: Error) => setError(err.message)); };

  if (id) {
    if (!detail) return <main><p>{error || "Đang tải…"}</p></main>;
    return (
      <main>
        <h1>{detail.documentNumber} · {detail.documentType}</h1>
        <p>Trạng thái: {detail.status} · Tạo bởi: {detail.createdBySub} · {detail.createdAt}</p>
        {detail.approval && <p>Phê duyệt: {detail.approval.state}
          {detail.approval.processInstanceId ? ` · Flowable: ${detail.approval.processInstanceId}` : ""}</p>}
        {detail.delivery && <p>Giao hàng: {detail.delivery.state}</p>}
        {detail.linkedIssueId && <p>Chứng từ xuất liên kết: {detail.linkedIssueId}</p>}
        <h2>Dòng chứng từ</h2>
        <table><thead><tr><th>#</th><th>Kho</th><th>Lô</th><th>Số lượng</th><th>Thực nhận</th><th>Kiểm đếm</th></tr></thead>
          <tbody>{detail.lines.map((line) => (
            <tr key={line.id}><td>{line.lineNo}</td><td>{line.warehouseId}</td><td>{line.batchId}</td>
              <td>{line.quantity ?? "—"}</td><td>{line.actualQuantity ?? "—"}</td><td>{line.countedQuantity ?? "—"}</td></tr>
          ))}</tbody></table>
        <h2>Biến động kho</h2>
        {detail.movements.length === 0 ? <p>Không có biến động kho.</p> :
          <table><thead><tr><th>Loại</th><th>Delta</th><th>Tồn sau</th><th>Thời gian</th></tr></thead>
            <tbody>{detail.movements.map((movement) => (
              <tr key={movement.id}><td>{movement.kind}</td><td>{movement.delta}</td>
                <td>{movement.balanceAfter}</td><td>{movement.createdAt}</td></tr>
            ))}</tbody></table>}
        <p><Link href="/trading/history">← Lịch sử chứng từ</Link></p>
      </main>
    );
  }

  return (
    <main>
      <h1>Lịch sử chứng từ</h1>
      {error && <p>{error}</p>}
      <form onSubmit={apply}>
        <label>Loại <select value={type} onChange={(event) => setType(event.target.value)}>
          {typeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Trạng thái <select value={status} onChange={(event) => setStatus(event.target.value)}>
          {statusOptions.map((value) => <option key={value} value={value}>{value || "Tất cả"}</option>)}
        </select></label>
        <label>Lô (batch id) <input value={batchId} onChange={(event) => setBatchId(event.target.value)} /></label>
        <label>Đối tác (partner id) <input value={partnerId} onChange={(event) => setPartnerId(event.target.value)} /></label>
        <label>Từ <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Đến <input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <button type="submit">Lọc</button>
      </form>
      <table><thead><tr><th>Số chứng từ</th><th>Loại</th><th>Trạng thái</th><th>Tạo bởi</th><th>Thời gian</th></tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item.id}>
            <td><Link href={`/trading/history/${item.id}`}>{item.documentNumber}</Link></td>
            <td>{item.documentType}</td><td>{item.status}</td><td>{item.createdBySub}</td><td>{item.createdAt}</td>
          </tr>
        ))}</tbody></table>
    </main>
  );
}
