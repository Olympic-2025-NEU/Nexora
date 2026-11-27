// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import type { Partner, PartnerConnectionView } from "../../lib/api-client/openapi-types";
import {
  createPartnerAction,
  patchPartnerAction,
  savePartnerConnectionAction,
} from "../../lib/h/actions";
import { StatusBanner } from "./status-banner";

export function PartnersPanel({
  initialPartners,
  connections,
  canManage,
}: {
  initialPartners: Partner[];
  connections: Record<string, PartnerConnectionView | null>;
  canManage: boolean;
}) {
  const [partners, setPartners] = useState(initialPartners);
  const [views, setViews] = useState(connections);
  const [issuerInstanceId, setIssuer] = useState("");
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [endpointUrl, setEndpointUrl] = useState("https://");
  const [outboundTokenUrl, setTokenUrl] = useState("https://");
  const [outboundClientId, setOutboundClientId] = useState("");
  const [outboundSecretRef, setSecretRef] = useState("");
  const [outboundAudience, setAudience] = useState("");
  const [inboundClientId, setInboundClientId] = useState("");
  const [allowedInboundScope, setScope] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create(event: FormEvent) {
    event.preventDefault();
    if (!canManage) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await createPartnerAction({
        issuerInstanceId: issuerInstanceId.trim(),
        code: code.trim(),
        displayName: displayName.trim(),
        ...(contactEmail.trim() ? { contactEmail: contactEmail.trim() } : {}),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(`Đã tạo đối tác ${result.data.id}.`);
      setIssuer("");
      setCode("");
      setDisplayName("");
      setContactEmail("");
      window.location.reload();
    });
  }

  function suspend(partner: Partner) {
    if (!canManage) return;
    setError(null);
    startTransition(async () => {
      const result = await patchPartnerAction(partner.id, { status: "suspended" }, partner.version);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setPartners((rows) => rows.map((row) =>
        row.id === partner.id ? { ...row, status: "suspended", version: row.version + 1 } : row));
    });
  }

  function activate(partner: Partner) {
    if (!canManage) return;
    setError(null);
    startTransition(async () => {
      const result = await patchPartnerAction(partner.id, { status: "active" }, partner.version);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setPartners((rows) => rows.map((row) =>
        row.id === partner.id ? { ...row, status: "active", version: row.version + 1 } : row));
    });
  }

  function saveConnection(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !selectedId) return;
    setError(null);
    setMessage(null);
    const secret = outboundSecretRef.trim();
    if (/^Bearer\s+/i.test(secret) || secret.split(".").length === 3) {
      setError("outboundSecretRef phải là tham chiếu, không phải token thô.");
      return;
    }
    startTransition(async () => {
      const result = await savePartnerConnectionAction(selectedId, {
        endpointUrl: endpointUrl.trim(),
        outboundTokenUrl: outboundTokenUrl.trim(),
        outboundClientId: outboundClientId.trim(),
        outboundSecretRef: secret,
        outboundAudience: outboundAudience.trim(),
        inboundClientId: inboundClientId.trim(),
        allowedInboundScope: allowedInboundScope.trim(),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setViews((current) => ({
        ...current,
        [selectedId]: {
          partnerId: selectedId,
          endpointHost: result.data.endpointHost,
          status: result.data.status,
          ...(result.data.rotatedAt ? { rotatedAt: result.data.rotatedAt } : {}),
        },
      }));
      setSecretRef("");
      setMessage("Đã lưu kết nối. Secret chỉ ghi một chiều và không được hiển thị lại.");
    });
  }

  return (
    <div className="stack">
      {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}
      {message ? <StatusBanner tone="success">{message}</StatusBanner> : null}

      {canManage ? (
        <form className="panel form-grid" onSubmit={create}>
          <h2>Thêm đối tác</h2>
          <label>Issuer instance ID
            <input value={issuerInstanceId} onChange={(e) => setIssuer(e.target.value)} required />
          </label>
          <label>Mã
            <input value={code} onChange={(e) => setCode(e.target.value)} required />
          </label>
          <label>Tên hiển thị
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </label>
          <label>Email liên hệ
            <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
          </label>
          <button type="submit" disabled={pending}>{pending ? "Đang tạo…" : "Tạo đối tác"}</button>
        </form>
      ) : null}

      <section className="panel">
        <h2>Danh sách đối tác</h2>
        <p className="muted">
          Trust id là <code>issuerInstanceId</code>. Secret kết nối chỉ ghi, không bao giờ đọc lại.
        </p>
        {!partners.length
          ? <StatusBanner tone="info">Chưa có đối tác.</StatusBanner>
          : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tên</th>
                  <th>Issuer</th>
                  <th>Trạng thái</th>
                  <th>Kết nối</th>
                  <th>Handoff P</th>
                  {canManage ? <th>Thao tác</th> : null}
                </tr>
              </thead>
              <tbody>
                {partners.map((partner) => {
                  const connection = views[partner.id];
                  return (
                    <tr key={partner.id}>
                      <td>{partner.code}</td>
                      <td>{partner.displayName}</td>
                      <td className="mono">{partner.issuerInstanceId}</td>
                      <td>{partner.status}</td>
                      <td>
                        {connection
                          ? `${connection.status} · ${connection.endpointHost}`
                          : (partner.connectionStatus ?? "—")}
                      </td>
                      <td>
                        <Link href={`/operations?partnerId=${encodeURIComponent(partner.id)}`}>
                          Dùng trong giao dịch
                        </Link>
                      </td>
                      {canManage ? (
                        <td className="actions">
                          <button type="button" disabled={pending}
                            onClick={() => setSelectedId(partner.id)}>
                            Kết nối
                          </button>
                          {partner.status === "active" ? (
                            <button type="button" disabled={pending} onClick={() => suspend(partner)}>
                              Tạm dừng
                            </button>
                          ) : (
                            <button type="button" disabled={pending} onClick={() => activate(partner)}>
                              Kích hoạt
                            </button>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </section>

      {canManage && selectedId ? (
        <form className="panel form-grid" onSubmit={saveConnection}>
          <h2>Upsert kết nối đối tác</h2>
          <p className="muted">Partner ID: <code>{selectedId}</code></p>
          <label>Endpoint URL
            <input value={endpointUrl} onChange={(e) => setEndpointUrl(e.target.value)} required />
          </label>
          <label>Outbound token URL
            <input value={outboundTokenUrl} onChange={(e) => setTokenUrl(e.target.value)} required />
          </label>
          <label>Outbound client ID
            <input value={outboundClientId} onChange={(e) => setOutboundClientId(e.target.value)} required />
          </label>
          <label>Outbound secret ref (write-only)
            <input value={outboundSecretRef} onChange={(e) => setSecretRef(e.target.value)}
              required autoComplete="off" />
          </label>
          <label>Outbound audience
            <input value={outboundAudience} onChange={(e) => setAudience(e.target.value)} required />
          </label>
          <label>Inbound client ID
            <input value={inboundClientId} onChange={(e) => setInboundClientId(e.target.value)} required />
          </label>
          <label>Allowed inbound scope
            <input value={allowedInboundScope} onChange={(e) => setScope(e.target.value)} required />
          </label>
          <div className="actions">
            <button type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu kết nối"}</button>
            <button type="button" className="text-button" onClick={() => setSelectedId(null)}>Hủy</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
