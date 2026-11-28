// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, type FormEvent } from "react";
import { adminApi } from "@/app/lib/admin-api";

type Node = { eventId: string; issuerInstanceId: string; batchId: string | null;
  originLot: { issuerInstanceId: string; lotId: string }; eventType: string;
  occurredAt: string; recordedAt: string; verificationState: string; depth: number;
  partnerObservedAt?: string; syncState?: "cached" | "stale";
  source: { documentId: string | null; eventId: string; payloadVersion: string } };
type Edge = { fromEventId: string; toEventId?: string;
  missingRef?: { issuerInstanceId: string; eventId: string }; relation: string;
  verificationState: string;
  allocationDetail?: { issueLineId: string; sourceLineId: string; quantity: string }[] };
type Gap = { fromEventId?: string; missingRef?: { issuerInstanceId: string; eventId: string };
  state: string; reason: string };
type Graph = { nodes: Node[]; edges: Edge[]; gaps: Gap[]; asOf: string;
  nextCursor?: string; truncated: boolean;
  localProjection: { state: string; pendingEvents: number } };
const reasons: Record<string, string> = {
  remote_source_unavailable: "Chưa có sự kiện nguồn đã xác minh từ đối tác",
  local_allocation_unknown: "Chưa có phân bổ phiếu nhập cụ thể cho phiếu xuất này",
  local_source_unavailable: "Sự kiện nguồn local chưa đọc được",
  projection_pending: "Worker trace còn sự kiện chưa xử lý",
  depth_limit: "Đã tới giới hạn độ sâu truy vấn",
  node_limit: "Đã tới giới hạn nút của truy vấn; hãy lọc theo chứng từ",
  partner_summary_stale: "Bản tóm tắt đối tác đã quá 24 giờ; cần đồng bộ lại",
};

export function BackwardTrace() {
  const [batchId, setBatchId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [graph, setGraph] = useState<Graph | null>(null);
  const [activeQuery, setActiveQuery] = useState<{ batchId: string; documentId: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function load(queryInput: { batchId: string; documentId: string }, cursor?: string) {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ depth: "10", limit: "20" });
      if (queryInput.documentId) query.set("documentId", queryInput.documentId);
      if (cursor) query.set("cursor", cursor);
      const response = await adminApi(`/api/v1/lots/${encodeURIComponent(queryInput.batchId)}/trace/backward?${query}`);
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      const body = await response.json() as { data: Graph };
      setGraph((previous) => cursor && previous ? {
        ...body.data, nodes: [...previous.nodes, ...body.data.nodes],
        edges: [...previous.edges, ...body.data.edges],
        gaps: [...previous.gaps, ...body.data.gaps.filter((gap) =>
          !previous.gaps.some((existing) => JSON.stringify(existing) === JSON.stringify(gap)))],
      } : body.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "TRACE_UNAVAILABLE"); }
    finally { setLoading(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGraph(null);
    const input = { batchId: batchId.trim(), documentId: documentId.trim() };
    setActiveQuery(input);
    void load(input);
  }
  return <section className="mt-6 space-y-4" aria-label="Truy ngược lô">
    <h2 className="text-xl font-semibold">Truy ngược theo lô</h2>
    <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
      <label className="flex min-w-72 flex-col gap-1 text-sm">ID lô local
        <input className="rounded border p-2" required value={batchId}
          onChange={(event) => setBatchId(event.target.value)} placeholder="UUID của lô" /></label>
      <label className="flex min-w-72 flex-col gap-1 text-sm">ID chứng từ (tùy chọn)
        <input className="rounded border p-2" value={documentId}
          onChange={(event) => setDocumentId(event.target.value)} placeholder="Thu hẹp về một chứng từ" /></label>
      <button className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        disabled={loading} type="submit">{loading ? "Đang tải…" : "Truy ngược"}</button>
    </form>
    {error && <p role="alert">Không đọc được graph: {error}</p>}
    {graph && <>
      <p role="status">Snapshot local lúc {new Date(graph.asOf).toLocaleString("vi-VN")};
        {` ${graph.nodes.length} sự kiện đã tải.`} {graph.localProjection.pendingEvents > 0 &&
          `${graph.localProjection.pendingEvents} sự kiện còn chờ projector.`}</p>
      <p className="text-sm text-muted-foreground">Các sự kiện cùng lô là bối cảnh lịch sử.
        Chỉ đường nối có nguồn xác nhận mới thể hiện quan hệ truy xuất.</p>
      <ol className="space-y-3">{graph.nodes.map((node) => <li key={node.eventId}
        className="rounded border p-3 text-sm">
        <strong>{node.eventType}</strong> · {new Date(node.occurredAt).toLocaleString("vi-VN")}
        <p>Issuer: {node.issuerInstanceId} · lô nguồn: {node.originLot.issuerInstanceId}/{node.originLot.lotId}</p>
        <p>Chứng từ: {node.source.documentId ?? "chưa có"} · xác minh: {node.verificationState}
          {node.syncState && ` · bản đối tác ${node.syncState === "stale" ? "cũ" : "đã lưu local"}`}</p>
        {node.partnerObservedAt && <p>Đối tác cập nhật: {new Date(node.partnerObservedAt).toLocaleString("vi-VN")}</p>}
        <p className="break-all text-muted-foreground">Event: {node.eventId} · source: {node.source.eventId}</p>
      </li>)}</ol>
      {graph.edges.length > 0 && <section><h3 className="font-semibold">Liên kết có nguồn</h3>
        <ul className="list-inside list-disc text-sm">{graph.edges.map((edge, index) =>
          <li key={`${edge.fromEventId}-${edge.relation}-${index}`} className="break-all">
            {edge.fromEventId} → {edge.toEventId ?? `${edge.missingRef?.issuerInstanceId}/${edge.missingRef?.eventId}`}
            {` (${edge.relation}, ${edge.verificationState})`}
            {edge.allocationDetail?.map((row) => <span key={`${row.issueLineId}-${row.sourceLineId}`}
              className="block pl-4">Dòng xuất {row.issueLineId} ← dòng nguồn {row.sourceLineId}: {row.quantity} đơn vị tồn</span>)}
          </li>)}</ul></section>}
      {graph.gaps.length > 0 && <section><h3 className="font-semibold">Khoảng thiếu / đang chờ</h3>
        <ul className="list-inside list-disc text-sm">{graph.gaps.map((gap, index) =>
          <li key={`${gap.fromEventId}-${gap.reason}-${index}`}>
            {reasons[gap.reason] ?? gap.reason}{gap.missingRef &&
              ` (${gap.missingRef.issuerInstanceId}/${gap.missingRef.eventId})`}</li>)}</ul></section>}
      {graph.nextCursor && activeQuery && <button type="button" disabled={loading}
        className="rounded border px-4 py-2 disabled:opacity-50"
        onClick={() => { void load(activeQuery, graph.nextCursor); }}>Tải thêm</button>}
    </>}
  </section>;
}
