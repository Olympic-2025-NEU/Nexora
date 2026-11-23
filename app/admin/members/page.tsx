// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState } from "react";
import { MEMBERSHIP_ROLES, type MembershipRole } from "@/contexts/system/domain/types";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { PageHeader } from "@/app/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";

type Member = {
  id: string;
  displayName: string;
  email?: string;
  role: string;
  status: string;
  version: number;
};

type MemberStatus = "invited" | "active" | "disabled";

function roleLabel(t: (k: string) => string, role: string): string {
  const key = `roles.${role}`;
  const translated = t(key);
  return translated !== key ? translated : role;
}

function statusLabel(t: (k: string) => string, status: string): string {
  const key = `admin.memberStatus.${status}`;
  const translated = t(key);
  return translated !== key ? translated : status;
}

export default function MembersAdminPage() {
  const t = useT();
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [provisionalPassword, setProvisionalPassword] = useState<string | null>(null);

  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MembershipRole>("staff");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi("/api/v1/members");
      if (res.status === 403) throw new Error(t("admin.forbidden"));
      if (!res.ok) throw new Error(`${t("admin.loadFailed")} (${res.status})`);
      const json = await res.json();
      setMembers((json.data ?? []) as Member[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function inviteMember() {
    setCreating(true);
    setError(null);
    setProvisionalPassword(null);
    try {
      const res = await adminApi("/api/v1/members", {
        method: "POST",
        body: JSON.stringify({
          username: inviteUsername.trim(),
          displayName: inviteName.trim(),
          email: inviteEmail.trim() || undefined,
          role: inviteRole,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        data?: Member & { provisionalPassword?: string; keycloakCreated?: boolean };
      };
      if (!res.ok) {
        throw new Error(
          `${t("admin.inviteFailed")} (${res.status}${json.error ? `: ${json.error}` : ""})`,
        );
      }
      if (json.data?.provisionalPassword) {
        setProvisionalPassword(json.data.provisionalPassword);
      }
      setInviteUsername("");
      setInviteName("");
      setInviteEmail("");
      setInviteRole("staff");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.inviteFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function patchMember(
    member: Member,
    patch: {
      role?: MembershipRole;
      status?: Exclude<MemberStatus, "invited">;
      displayName?: string;
      email?: string | null;
    },
  ) {
    setSavingId(member.id);
    setError(null);
    try {
      const res = await adminApi(`/api/v1/members/${member.id}`, {
        method: "PATCH",
        headers: { "if-match": String(member.version) },
        body: JSON.stringify({ ...patch, version: member.version }),
      });
      if (!res.ok) throw new Error(`${t("admin.saveFailed")} (${res.status})`);
      const json = await res.json();
      setMembers((prev) =>
        prev.map((row) => (row.id === member.id ? (json.data as Member) : row)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.saveFailed"));
      await load();
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="w-full space-y-6">
      <PageHeader
        title={t("admin.membersTitle")}
        description={t("admin.membersBody")}
        actions={
          <Button type="button" variant="outline" onClick={() => void load()}>
            {t("admin.refresh")}
          </Button>
        }
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {provisionalPassword ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium">{t("admin.provisionalPasswordTitle")}</p>
          <p className="mt-1 text-muted-foreground">{t("admin.provisionalPasswordBody")}</p>
          <code className="mt-2 block break-all rounded-md bg-card px-3 py-2 font-mono text-foreground">
            {provisionalPassword}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setProvisionalPassword(null)}
          >
            {t("admin.provisionalPasswordDismiss")}
          </Button>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
        <h2 className="mb-4 text-base font-semibold">{t("admin.inviteTitle")}</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-username">{t("admin.memberUsername")}</Label>
            <Input
              id="invite-username"
              value={inviteUsername}
              onChange={(e) => setInviteUsername(e.target.value)}
              autoComplete="off"
              placeholder="jane.doe"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">{t("admin.memberName")}</Label>
            <Input
              id="invite-name"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">{t("admin.memberEmail")}</Label>
            <Input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("admin.memberRole")}</Label>
            <Select
              value={inviteRole}
              onValueChange={(value) => setInviteRole(value as MembershipRole)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEMBERSHIP_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {roleLabel(t, role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("admin.inviteHint")}</p>
        <div className="mt-4">
          <Button
            type="button"
            disabled={creating || !inviteUsername.trim() || !inviteName.trim()}
            onClick={() => void inviteMember()}
          >
            {creating ? t("admin.loading") : t("admin.inviteAction")}
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("admin.memberName")}</th>
                <th className="px-3 py-2 font-medium">{t("admin.memberEmail")}</th>
                <th className="px-3 py-2 font-medium">{t("admin.memberRole")}</th>
                <th className="px-3 py-2 font-medium">{t("admin.memberStatusLabel")}</th>
                <th className="px-3 py-2 font-medium">{t("admin.orgVersion")}</th>
                <th className="px-3 py-2 font-medium">{t("admin.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const busy = savingId === m.id;
                return (
                  <tr key={m.id} className="border-b border-border/70">
                    <td className="px-3 py-2 align-middle font-medium">{m.displayName}</td>
                    <td className="px-3 py-2 align-middle text-muted-foreground">
                      {m.email || "—"}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <Select
                        value={m.role}
                        disabled={busy}
                        onValueChange={(value) =>
                          void patchMember(m, { role: value as MembershipRole })
                        }
                      >
                        <SelectTrigger className="h-8 w-[11rem]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MEMBERSHIP_ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {roleLabel(t, role)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2 align-middle">{statusLabel(t, m.status)}</td>
                    <td className="px-3 py-2 align-middle">v{m.version}</td>
                    <td className="px-3 py-2 align-middle">
                      <div className="flex flex-wrap gap-2">
                        {m.status === "invited" || m.status === "disabled" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void patchMember(m, { status: "active" })}
                          >
                            {t("admin.activate")}
                          </Button>
                        ) : null}
                        {m.status !== "disabled" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void patchMember(m, { status: "disabled" })}
                          >
                            {t("admin.disable")}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
