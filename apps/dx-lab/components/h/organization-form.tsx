// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { Organization } from "../../lib/api-client/openapi-types";
import { saveOrganizationAction } from "../../lib/h/actions";
import { StatusBanner } from "./status-banner";

export function OrganizationForm({
  organization,
  canEdit,
}: {
  organization: Organization;
  canEdit: boolean;
}) {
  const [name, setName] = useState(organization.name);
  const [contactEmail, setContactEmail] = useState(organization.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(organization.contactPhone ?? "");
  const [address, setAddress] = useState(organization.address ?? "");
  const [timezone, setTimezone] = useState(organization.timezone);
  const [version, setVersion] = useState(organization.version);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await saveOrganizationAction({
        name: name.trim(),
        contactEmail: contactEmail.trim() || null,
        contactPhone: contactPhone.trim() || null,
        address: address.trim() || null,
        timezone: timezone.trim(),
      }, version);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setVersion((current) => current + 1);
      setMessage("Đã lưu hồ sơ tổ chức.");
    });
  }

  return (
    <form className="panel form-grid" onSubmit={onSubmit}>
      <h2>Hồ sơ tổ chức</h2>
      <dl className="profile">
        <dt>Mã</dt><dd>{organization.code}</dd>
        <dt>Instance</dt><dd>{organization.instanceId}</dd>
        <dt>Trạng thái</dt><dd>{organization.status}</dd>
        <dt>Phiên bản</dt><dd>v{version}</dd>
      </dl>
      {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}
      {message ? <StatusBanner tone="success">{message}</StatusBanner> : null}
      <label>Tên
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit || pending} required />
      </label>
      <label>Email liên hệ
        <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
          disabled={!canEdit || pending} />
      </label>
      <label>Điện thoại
        <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
          disabled={!canEdit || pending} />
      </label>
      <label>Địa chỉ
        <input value={address} onChange={(e) => setAddress(e.target.value)} disabled={!canEdit || pending} />
      </label>
      <label>Múi giờ
        <input value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={!canEdit || pending} required />
      </label>
      {canEdit
        ? <button type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu tổ chức"}</button>
        : <StatusBanner tone="info">Chỉ Administrator được sửa hồ sơ tổ chức.</StatusBanner>}
    </form>
  );
}
