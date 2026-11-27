// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import QRCode from "qrcode";
import { useState, useTransition, type FormEvent } from "react";
import { issueQrAction, revokeQrAction } from "../../lib/d/qr-actions";
import { StatusBanner } from "../h/status-banner";

export function QrIssuer({ batchId }: { batchId: string }) {
  const [policyVersion, setPolicyVersion] = useState("v1");
  const [url, setUrl] = useState("");
  const [image, setImage] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function issue(event: FormEvent) {
    event.preventDefault();
    setUrl(""); setImage(""); setTokenId(""); setError(""); setMessage("");
    startTransition(async () => {
      const result = await issueQrAction(batchId, policyVersion.trim());
      if (!result.ok) { setError(result.message); return; }
      try {
        const qr = await QRCode.toDataURL(result.data.url,
          { errorCorrectionLevel: "M", margin: 4, width: 320 });
        setUrl(result.data.url);
        setImage(qr);
        setTokenId(result.data.tokenId);
      } catch {
        setError("Không tạo được ảnh QR từ URL đã phát hành.");
      }
    });
  }

  function revoke() {
    if (!tokenId) return;
    setError("");
    startTransition(async () => {
      const result = await revokeQrAction(batchId, tokenId);
      if (!result.ok) { setError(result.message); return; }
      setImage(""); setUrl(""); setTokenId("");
      setMessage("Đã thu hồi QR. Passport cũ phải trả về không hợp lệ.");
    });
  }

  return <section className="panel stack">
    <h2>QR Passport công khai</h2>
    <p className="muted">Chỉ phát hành sau khi chính sách công bố đã được duyệt. URL chỉ hiện trong phiên này.</p>
    <form className="form-grid" onSubmit={issue}>
      <label>Phiên bản chính sách
        <input value={policyVersion} onChange={(event) => setPolicyVersion(event.target.value)}
          pattern="v[1-9][0-9]*" required disabled={pending} />
      </label>
      <button type="submit" disabled={pending}>{pending ? "Đang phát hành…" : "Phát hành QR"}</button>
    </form>
    {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}
    {message ? <StatusBanner tone="success">{message}</StatusBanner> : null}
    {image ? <>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URI generated from server-issued public URL */}
      <img src={image} width={320} height={320} alt="Mã QR mở Passport công khai của lô" />
      <a href={url} rel="noreferrer" target="_blank">Mở Passport</a>
      <a href={image} download="nexora-passport-qr.png">Tải PNG</a>
      <button type="button" disabled={pending} onClick={revoke}>Thu hồi QR</button>
    </> : null}
  </section>;
}
