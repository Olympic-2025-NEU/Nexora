// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, type FormEvent } from "react";
import { adminApi } from "@/app/lib/admin-api";

type FileMeta = { id: string; scanState: string; checksum: string };
type EvidenceRow = { id: string; eventId: string; documentId: string;
  attachmentId: string; checksumHex: string; visibility: string; state: string;
  attachment: { scanState: string; mimeType: string } };

async function data<T>(response: Response): Promise<T> {
  const body = await response.json() as { data?: T; code?: string; error?: string };
  if (!response.ok || !body.data) throw new Error(body.code ?? body.error ?? `HTTP ${response.status}`);
  return body.data;
}

export function TraceEvidence() {
  const [batchId, setBatchId] = useState("");
  const [eventId, setEventId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState("");
  const [scanState, setScanState] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [rows, setRows] = useState<EvidenceRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const base = `/api/v1/lots/${encodeURIComponent(batchId.trim())}/evidence`;
  async function act(job: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await job(); } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thực hiện được thao tác.");
    } finally { setBusy(false); }
  }
  async function upload() {
    if (!file) return;
    const body = new FormData();
    body.set("file", file);
    const uploaded = await data<{ id: string; scanState: string }>(await adminApi("/api/v1/files", {
      method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body }));
    setFileId(uploaded.id); setScanState(uploaded.scanState);
    setMessage("Đã tải lên vùng kiểm dịch. Chờ scan sạch trước khi gắn chứng từ.");
  }
  async function checkScan() {
    const meta = await data<FileMeta>(await adminApi(`/api/v1/files/${encodeURIComponent(fileId.trim())}`));
    setScanState(meta.scanState);
    setMessage(`Scan: ${meta.scanState}; SHA-256: ${meta.checksum}`);
  }
  async function attach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await act(async () => {
      await data(await adminApi(base, { method: "POST", body: JSON.stringify({
        eventId: eventId.trim(), attachmentId: fileId.trim(), visibility }) }));
      setMessage("Đã liên kết file sạch. Nếu công bố public, duyệt/rebuild projection trước khi quét QR.");
      setRows(await data<EvidenceRow[]>(await adminApi(base)));
    });
  }
  async function download(row: EvidenceRow) {
    const response = await adminApi(`/api/v1/files/${encodeURIComponent(row.attachmentId)}?download=1`);
    if (!response.ok) throw new Error(`Không có quyền tải file: HTTP ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a"); link.href = url;
      link.download = `evidence-${row.attachmentId}`;
      document.body.append(link); link.click(); link.remove();
    } finally { URL.revokeObjectURL(url); }
  }
  return <section className="mt-8 space-y-4" aria-label="Evidence nguồn">
    <h2 className="text-xl font-semibold">Evidence nguồn</h2>
    <p className="text-sm text-muted-foreground">Chỉ file đã scan sạch được gắn vào sự kiện của chứng từ
      confirmed. Bản public cần policy evidence và timeline cùng được duyệt công khai.</p>
    <div className="flex flex-wrap gap-3">
      <label className="flex flex-col gap-1 text-sm">ID lô
        <input className="min-w-72 rounded border p-2" value={batchId} onChange={(event) =>
          setBatchId(event.target.value)} /></label>
      <label className="flex flex-col gap-1 text-sm">ID sự kiện trace
        <input className="min-w-72 rounded border p-2" value={eventId} onChange={(event) =>
          setEventId(event.target.value)} /></label>
    </div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">File PDF/PNG/JPEG/TXT
        <input type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" onChange={(event) =>
          setFile(event.target.files?.[0] ?? null)} /></label>
      <button type="button" disabled={busy || !file} className="rounded border px-3 py-2"
        onClick={() => { void act(upload); }}>Tải lên và scan</button>
    </div>
    <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { void attach(event); }}>
      <label className="flex flex-col gap-1 text-sm">Attachment ID
        <input className="min-w-72 rounded border p-2" required value={fileId} onChange={(event) =>
          setFileId(event.target.value)} /></label>
      <button type="button" disabled={busy || !fileId.trim()} className="rounded border px-3 py-2"
        onClick={() => { void act(checkScan); }}>Kiểm tra scan</button>
      <label className="flex flex-col gap-1 text-sm">Phạm vi
        <select className="rounded border p-2" value={visibility} onChange={(event) =>
          setVisibility(event.target.value)}>
          <option value="private">private</option><option value="partner">partner</option>
          <option value="public">public (Administrator)</option>
        </select></label>
      <button type="submit" disabled={busy || !batchId.trim() || !eventId.trim() ||
        !fileId.trim() || (Boolean(scanState) && scanState !== "clean")}
      className="rounded bg-primary px-3 py-2 text-primary-foreground">Gắn evidence</button>
      <button type="button" disabled={busy || !batchId.trim()} className="rounded border px-3 py-2"
        onClick={() => { void act(async () => {
          setRows(await data<EvidenceRow[]>(await adminApi(base)));
        }); }}>Xem liên kết</button>
      <button type="button" disabled={busy || !batchId.trim()} className="rounded border px-3 py-2"
        onClick={() => { void act(async () => {
          await data(await adminApi(`/api/v1/lots/${encodeURIComponent(batchId.trim())}/passport-policy/rebuild`,
            { method: "POST" }));
          setMessage("Projection đã được dựng lại theo policy và nguồn hiện tại.");
        }); }}>Rebuild Passport (Administrator)</button>
    </form>
    {message && <p role="status" className="text-sm">{message}</p>}
    <ul className="space-y-2">{rows.map((row) => <li key={row.id} className="rounded border p-3 text-sm">
      <p>Event {row.eventId}; chứng từ {row.documentId}</p>
      <p>File {row.attachmentId}; SHA-256 {row.checksumHex}</p>
      <p>{row.visibility} · {row.state} · scan {row.attachment.scanState}</p>
      {row.state === "active" && row.attachment.scanState === "clean" && <button type="button"
        className="underline" onClick={() => { void act(() => download(row)); }}>Tải nếu có quyền</button>}
      {row.state === "active" && <button type="button" className="ml-3 underline"
        onClick={() => { void act(async () => {
          const response = await adminApi(`${base}/${encodeURIComponent(row.id)}/revoke`,
            { method: "POST", body: JSON.stringify({ reason: "Owner withdrew evidence" }) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          setRows(await data<EvidenceRow[]>(await adminApi(base)));
          setMessage("Đã thu hồi evidence; Passport cần rebuild để cập nhật timeline.");
        }); }}>Thu hồi</button>}
    </li>)}</ul>
  </section>;
}
