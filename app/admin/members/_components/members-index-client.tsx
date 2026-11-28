// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Shield } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";
import { MemberEditModal } from "./member-edit-modal";
import { MemberInviteModal } from "./member-invite-modal";
import { MemberRolesModal } from "./member-roles-modal";
import {
  formatRolesSummary,
  statusLabel,
  type MemberRow,
} from "./types";

export function MembersIndexClient() {
  const t = useT();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [rolesMember, setRolesMember] = useState<MemberRow | null>(null);
  const [provisionalPassword, setProvisionalPassword] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi("/api/v1/members");
      if (res.status === 403) throw new Error(t("admin.forbidden"));
      if (!res.ok) throw new Error(`${t("admin.loadFailed")} (${res.status})`);
      const json = await res.json();
      setMembers((json.data ?? []) as MemberRow[]);
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

  useEffect(() => {
    setEditing((prev) => (prev ? (members.find((m) => m.id === prev.id) ?? null) : null));
    setRolesMember((prev) =>
      prev ? (members.find((m) => m.id === prev.id) ?? null) : null,
    );
  }, [members]);

  return (
    <section className="w-full space-y-6">
      <PageHeader
        title={t("admin.membersTitle")}
        description={t("admin.membersBody")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void load()}>
              {t("admin.refresh")}
            </Button>
            <Button type="button" onClick={() => setInviteOpen(true)}>
              <Plus className="h-4 w-4" />
              {t("admin.inviteAction")}
            </Button>
          </div>
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

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>
      ) : members.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-10">
          <p className="text-sm text-muted-foreground">{t("admin.emptyMembers")}</p>
          <Button type="button" onClick={() => setInviteOpen(true)}>
            {t("admin.inviteAction")}
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">{t("admin.memberName")}</th>
                <th className="px-3 py-2.5 font-medium">{t("admin.memberEmail")}</th>
                <th className="px-3 py-2.5 font-medium">{t("admin.memberStatusLabel")}</th>
                <th className="px-3 py-2.5 font-medium">{t("admin.memberRoles")}</th>
                <th className="px-3 py-2.5 font-medium">{t("admin.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-border/70 hover:bg-muted/20">
                  <td className="px-3 py-2.5 font-medium">{m.displayName}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{m.email || "—"}</td>
                  <td className="px-3 py-2.5">{statusLabel(t, m.status)}</td>
                  <td className="max-w-[18rem] px-3 py-2.5 text-xs text-muted-foreground">
                    {formatRolesSummary(t, m)}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditing(m)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {t("admin.editMember")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setRolesMember(m)}
                      >
                        <Shield className="h-3.5 w-3.5" />
                        {t("admin.assignRoles")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <MemberInviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSaved={(pwd) => {
          if (pwd) setProvisionalPassword(pwd);
          void load();
        }}
      />
      <MemberEditModal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        member={editing}
        onSaved={() => void load()}
      />
      <MemberRolesModal
        open={Boolean(rolesMember)}
        onClose={() => setRolesMember(null)}
        member={rolesMember}
        onSaved={() => void load()}
      />
    </section>
  );
}
