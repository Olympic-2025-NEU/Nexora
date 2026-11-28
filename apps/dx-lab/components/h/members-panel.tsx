// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { Member } from "../../lib/api-client/openapi-types";
import { inviteMemberAction, patchMemberAction } from "../../lib/h/actions";
import { StatusBanner } from "./status-banner";

const roles = ["administrator", "staff", "approver", "viewer"] as const;

export function MembersPanel({ initialMembers }: { initialMembers: Member[] }) {
  const [members, setMembers] = useState(initialMembers);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof roles)[number]>("staff");
  const [provisionalPassword, setProvisionalPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  function invite(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setProvisionalPassword(null);
    startTransition(async () => {
      const result = await inviteMemberAction({
        username: username.trim(),
        displayName: displayName.trim(),
        role,
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (result.data.provisionalPassword) setProvisionalPassword(result.data.provisionalPassword);
      const member = { ...result.data };
      delete member.provisionalPassword;
      setMembers((rows) => [member, ...rows]);
      setUsername("");
      setDisplayName("");
      setEmail("");
      setRole("staff");
    });
  }

  function disable(member: Member) {
    setBusyId(member.id);
    setError(null);
    startTransition(async () => {
      const result = await patchMemberAction(member.id, { status: "disabled" }, member.version);
      setBusyId(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMembers((rows) => rows.map((row) =>
        row.id === member.id ? { ...row, status: "disabled", version: row.version + 1 } : row));
    });
  }

  function activate(member: Member) {
    setBusyId(member.id);
    setError(null);
    startTransition(async () => {
      const result = await patchMemberAction(member.id, { status: "active" }, member.version);
      setBusyId(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMembers((rows) => rows.map((row) =>
        row.id === member.id ? { ...row, status: "active", version: row.version + 1 } : row));
    });
  }

  return (
    <div className="stack">
      {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}
      {provisionalPassword ? (
        <StatusBanner tone="warning">
          Mật khẩu tạm thời (chỉ hiện một lần): <code>{provisionalPassword}</code>
          {" "}
          <button type="button" className="text-button" onClick={() => setProvisionalPassword(null)}>
            Ẩn
          </button>
        </StatusBanner>
      ) : null}

      <form className="panel form-grid" onSubmit={invite}>
        <h2>Mời thành viên</h2>
        <label>Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="off" />
        </label>
        <label>Tên hiển thị
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </label>
        <label>Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>Vai trò
          <select value={role} onChange={(e) => setRole(e.target.value as (typeof roles)[number])}>
            {roles.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <button type="submit" disabled={pending}>{pending ? "Đang mời…" : "Mời"}</button>
      </form>

      <section className="panel">
        <h2>Danh sách thành viên</h2>
        {!members.length
          ? <StatusBanner tone="info">Chưa có thành viên.</StatusBanner>
          : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tên</th>
                  <th>Vai trò</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <div>{member.displayName}</div>
                      {member.email ? <div className="muted">{member.email}</div> : null}
                    </td>
                    <td>{member.role}</td>
                    <td>{member.status}</td>
                    <td className="actions">
                      {member.status !== "disabled" ? (
                        <button type="button" disabled={busyId === member.id || pending}
                          onClick={() => disable(member)}>
                          Vô hiệu hóa
                        </button>
                      ) : (
                        <button type="button" disabled={busyId === member.id || pending}
                          onClick={() => activate(member)}>
                          Kích hoạt
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>
    </div>
  );
}
