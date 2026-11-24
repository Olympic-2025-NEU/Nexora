// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { adminApi } from "@/app/lib/admin-api";

type Visibility = "private" | "partner" | "public";
type Policy = { organization: Visibility; product: Visibility; batch: Visibility;
  timeline: Visibility; evidence: Visibility };
type Issued = { qrUrl: string; tokenId: string };
const defaultPolicy: Policy = { organization: "public", product: "public",
  batch: "public", timeline: "public", evidence: "private" };

async function readResult<T>(response: Response): Promise<T> {
  const body = await response.json() as { data?: T; error?: string };
  if (!response.ok || !body.data) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body.data;
}

export function QrPassport() {
  const [role, setRole] = useState("");
  const [batchId, setBatchId] = useState("");
  const [policyVersion, setPolicyVersion] = useState("v1");
  const [policy, setPolicy] = useState<Policy>(defaultPolicy);
  const [draftVersion, setDraftVersion] = useState<number | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [qrImage, setQrImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { void adminApi("/api/v1/me").then(async (response) => {
    if (!response.ok) return;
    const body = await response.json() as { roles?: string[] };
    setRole(body.roles?.includes("administrator") ? "administrator" : "");
  }).catch(() => {}); }, []);

  async function act(job: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await job(); } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thực hiện được thao tác.");
    } finally { setBusy(false); }
  }
  function update(field: keyof Policy, value: Visibility) {
    setPolicy((current) => ({ ...current, [field]: value }));
  }
  async function createDraft() {
    const result = await readResult<{ policyVersion: number }>(await adminApi(
      `/api/v1/lots/${encodeURIComponent(batchId.trim())}/passport-policy`,
      { method: "POST", body: JSON.stringify(policy) }));
    setDraftVersion(result.policyVersion);
    setMessage(`Đã tạo bản nháp v${result.policyVersion}; chưa công bố.`);
  }
  async function approve() {
    if (!draftVersion) return;
    const result = await readResult<{ projectionState: string }>(await adminApi(
      `/api/v1/lots/${encodeURIComponent(batchId.trim())}/passport-policy/approve`,
      { method: "POST", body: JSON.stringify({ version: draftVersion }) }));
    setPolicyVersion(`v${draftVersion}`);
    setDraftVersion(null);
    setMessage(`Đã duyệt v${draftVersion}; projection: ${result.projectionState}.`);
  }
  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await act(async () => {
      setIssued(null); setQrImage("");
      const result = await readResult<Issued>(await adminApi(
        `/api/v1/lots/${encodeURIComponent(batchId.trim())}/qr`,
        { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ policyVersion: policyVersion.trim() }) }));
      const image = await QRCode.toDataURL(result.qrUrl,
        { errorCorrectionLevel: "M", margin: 4, width: 320 });
      setIssued(result); setQrImage(image);
      setMessage("QR đã phát hành. Hãy tải hoặc in ngay; URL gốc không được lưu để đọc lại.");
    });
  }
  async function revoke() {
    if (!issued) return;
    await act(async () => {
      const response = await adminApi(`/api/v1/lots/${encodeURIComponent(batchId.trim())}/qr/` +
        `${encodeURIComponent(issued.tokenId)}/revoke`,
      { method: "POST", body: JSON.stringify({ reason: "Owner revoked QR" }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setIssued(null); setQrImage("");
      setMessage("QR đã bị thu hồi; URL cũ trả 404.");
    });
  }
  return <section className="mt-8 space-y-4" aria-label="Passport và mã QR">
    <h2 className="text-xl font-semibold">Passport và mã QR</h2>
    <p className="text-sm text-muted-foreground">Chỉ lô available có chính sách đã duyệt và projection active
      mới phát hành QR. Token có hạn 30 ngày.</p>
    <form onSubmit={(event) => { void issue(event); }} className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-72 flex-col gap-1 text-sm">ID lô local
        <input className="rounded border p-2" required value={batchId}
          onChange={(event) => { setBatchId(event.target.value); setIssued(null); setQrImage(""); }} /></label>
      <label className="flex flex-col gap-1 text-sm">Phiên bản policy
        <input className="w-24 rounded border p-2" required value={policyVersion}
          onChange={(event) => setPolicyVersion(event.target.value)} placeholder="v1" /></label>
      <button className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        disabled={busy} type="submit">Phát hành QR</button>
    </form>
    {role === "administrator" && <details className="rounded border p-4">
      <summary className="cursor-pointer font-medium">Quản lý chính sách công bố (Administrator)</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(Object.keys(policy) as (keyof Policy)[]).map((field) => <label key={field}
          className="flex flex-col gap-1 text-sm">{field}
          <select className="rounded border p-2" value={policy[field]}
            onChange={(event) => update(field, event.target.value as Visibility)}>
            <option value="private">private</option><option value="partner">partner</option>
            <option value="public">public</option>
          </select></label>)}
      </div>
      <p className="mt-2 text-xs">Evidence chỉ được hiển thị ở T07 sau kiểm tra scan và quyền file.</p>
      <div className="mt-3 flex gap-2">
        <button className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy || !batchId.trim()}
          onClick={() => { void act(createDraft); }} type="button">Tạo bản nháp</button>
        <button className="rounded border px-3 py-2 disabled:opacity-50"
          disabled={busy || !draftVersion} onClick={() => { void act(approve); }} type="button">
          Duyệt v{draftVersion ?? "…"}</button>
      </div>
    </details>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {issued && qrImage && <div className="qr-print-area w-fit rounded border bg-white p-4 text-black">
      <p className="font-semibold">Nexora Passport</p>
      {/* QRCode creates the data URI from the server-issued one-time URL. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="Mã QR Passport" src={qrImage} width={320} height={320} />
      <p className="max-w-80 break-all text-xs">{issued.qrUrl}</p>
      <div className="mt-3 flex flex-wrap gap-2 print:hidden">
        <a className="rounded border px-3 py-2" href={qrImage} download="nexora-passport-qr.png">Tải PNG</a>
        <button className="rounded border px-3 py-2" onClick={() => window.print()}
          type="button">In QR</button>
        <button className="rounded border px-3 py-2" onClick={() => { void revoke(); }}
          type="button" disabled={busy}>Thu hồi QR</button>
      </div>
    </div>}
  </section>;
}
