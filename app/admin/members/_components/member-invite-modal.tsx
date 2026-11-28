// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState } from "react";
import type { MembershipRole } from "@/contexts/system/domain/types";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Modal } from "@/app/components/ui/modal";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";
import { RoleChecklist } from "./role-checklist";
import type { MemberRow } from "./types";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (provisionalPassword?: string | null) => void;
};

export function MemberInviteModal({ open, onClose, onSaved }: Props) {
  const t = useT();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<MembershipRole[]>(["sales_clerk"]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUsername("");
    setDisplayName("");
    setEmail("");
    setRoles(["sales_clerk"]);
    setError(null);
  }, [open]);

  async function invite() {
    if (roles.length === 0) {
      setError(t("admin.rolesRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi("/api/v1/members", {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          displayName: displayName.trim(),
          email: email.trim() || undefined,
          roles,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        data?: MemberRow & { provisionalPassword?: string };
      };
      if (!res.ok) {
        throw new Error(
          `${t("admin.inviteFailed")} (${res.status}${json.error ? `: ${json.error}` : ""})`,
        );
      }
      onSaved(json.data?.provisionalPassword ?? null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.inviteFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t("admin.inviteTitle")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("catalog.cancel")}
          </Button>
          <Button
            type="button"
            disabled={busy || !username.trim() || !displayName.trim() || roles.length === 0}
            onClick={() => void invite()}
          >
            {busy ? t("admin.loading") : t("admin.inviteAction")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <p className="text-sm text-muted-foreground">{t("admin.inviteHint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="invite-username">{t("admin.memberUsername")}</Label>
            <Input
              id="invite-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              placeholder="jane.doe"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="invite-name">{t("admin.memberName")}</Label>
            <Input
              id="invite-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="invite-email">{t("admin.memberEmail")}</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label>{t("admin.memberRoles")}</Label>
          <RoleChecklist value={roles} onChange={setRoles} disabled={busy} />
        </div>
      </div>
    </Modal>
  );
}
