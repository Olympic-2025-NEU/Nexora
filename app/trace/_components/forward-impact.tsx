// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, type FormEvent } from "react";
import { adminApi } from "@/app/lib/admin-api";

type Impact = { eventId: string; sourceDocumentId: string; sourceLineId: string;
  kind: string; quantity: string; uomId: string; uomCode?: string;
  verificationState: "confirmed" | "partner_asserted";
  sentQuantity?: string; actualQuantity?: string;
  partner?: { id?: string; issuerInstanceId: string } };
type Gap = { fromEventId?: string; state: string; reason: string;
  partnerIssuerInstanceId?: string };
type Graph = { nodes: { eventId: string }[]; impact: Impact[]; gaps: Gap[];
  asOf: string; nextCursor?: string; truncated: boolean;
  localProjection: { state: string; pendingEvents: number } };
const labels: Record<string, string> = { issue: "Xuất kho", transfer: "Chuyển đối tác",
  receiving: "Nhận hàng", sale: "Bán hàng" };

export function ForwardImpact() {
  const [batchId, setBatchId] = useState("");
  const [activeBatch, setActiveBatch] = useState("");
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function load(id: string, cursor?: string) {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ depth: "10", limit: "20" });
      if (cursor) query.set("cursor", cursor);
      const response = await adminApi(`/api/v1/lots/${encodeURIComponent(id)}/trace/forward?${query}`);
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      const body = await response.json() as { data: Graph };
      setGraph((previous) => cursor && previous ? {
        ...body.data, nodes: [...previous.nodes, ...body.data.nodes],
        impact: [...previous.impact, ...body.data.impact],
        gaps: [...previous.gaps, ...body.data.gaps.filter((gap) =>
          !previous.gaps.some((old) => JSON.stringify(old) === JSON.stringify(gap)))],
      } : body.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "TRACE_UNAVAILABLE"); }
    finally { setLoading(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = batchId.trim();
    setActiveBatch(id);
    setGraph(null);
    void load(id);
  }
  return <section className="mt-8 space-y-4" aria-label="Truy xuôi và tác động">
    <h2 className="text-xl font-semibold">Truy xuôi và danh sách tác động</h2>
    <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
      <label className="flex min-w-72 flex-col gap-1 text-sm">ID lô local
        <input className="rounded border p-2" required value={batchId}
          onChange={(event) => setBatchId(event.target.value)} placeholder="UUID của lô" /></label>
      <button className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        disabled={loading} type="submit">{loading ? "Đang tải…" : "Truy xuôi"}</button>
    </form>
    {error && <p role="alert">Không đọc được danh sách tác động: {error}</p>}
    {graph && <>
      <p role="status">Dữ liệu local lúc {new Date(graph.asOf).toLocaleString("vi-VN")}.
        {graph.localProjection.pendingEvents > 0 &&
          ` ${graph.localProjection.pendingEvents} sự kiện còn chờ projector.`}</p>
      <p className="text-sm text-muted-foreground">Số lượng của phiếu xuất, chuyển và bán là các bước
        của cùng dòng hàng; không cộng các dòng này thành tổng. Bên nhận chỉ được xác nhận khi có
        sự kiện nguồn hợp lệ.</p>
      {graph.impact.length ? <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm">
        <thead><tr><th className="border p-2">Bước</th><th className="border p-2">Số lượng</th>
          <th className="border p-2">Đối tác</th><th className="border p-2">Trạng thái</th>
          <th className="border p-2">Nguồn</th></tr></thead>
        <tbody>{graph.impact.map((row) => <tr key={`${row.eventId}-${row.sourceLineId}`}>
          <td className="border p-2">{labels[row.kind] ?? row.kind}</td>
          <td className="border p-2">{row.quantity} {row.uomCode ?? row.uomId}
            {row.kind === "receiving" && ` (gửi ${row.sentQuantity}, thực nhận ${row.actualQuantity})`}</td>
          <td className="border p-2">{row.partner?.issuerInstanceId ?? "—"}</td>
          <td className="border p-2">{row.verificationState}</td>
          <td className="border p-2 break-all">{row.sourceDocumentId} / {row.sourceLineId}</td>
        </tr>)}</tbody></table></div> : <p>Chưa có dòng tác động local đã xác nhận trong phạm vi xem.</p>}
      {graph.gaps.length > 0 && <section><h3 className="font-semibold">Khoảng chưa biết</h3>
        <ul className="list-inside list-disc text-sm">{graph.gaps.map((gap, index) =>
          <li key={`${gap.fromEventId}-${gap.reason}-${index}`}>
            {gap.reason === "downstream_unreported" ?
              `Chưa có xác nhận downstream từ ${gap.partnerIssuerInstanceId ?? "đối tác"}` : gap.reason}
            {` (${gap.state})`}</li>)}</ul></section>}
      {graph.nextCursor && <button type="button" disabled={loading}
        className="rounded border px-4 py-2 disabled:opacity-50"
        onClick={() => { void load(activeBatch, graph.nextCursor); }}>Tải thêm</button>}
    </>}
  </section>;
}
