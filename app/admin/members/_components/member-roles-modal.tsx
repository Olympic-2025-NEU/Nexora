// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState } from "react";
import type { MembershipRole } from "@/contexts/system/domain/types";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { Modal } from "@/app/components/ui/modal";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";
import { RoleChecklist } from "./role-checklist";
import { memberRoles, type MemberRow } from "./types";

type Props = {
  open: boolean;
  onClose: () => void;
  member: MemberRow | null;
  onSaved: () => void;
};

export function MemberRolesModal({ open, onClose, member, onSaved }: Props) {
  const t = useT();
  const [roles, setRoles] = useState<MembershipRole[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !member) return;
    setRoles(memberRoles(member));
    setError(null);
  }, [open, member]);

  async function save() {
    if (!member) return;
    if (roles.length === 0) {
      setError(t("admin.rolesRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi(`/api/v1/members/${member.id}`, {
        method: "PATCH",
        headers: { "if-match": String(member.version) },
        body: JSON.stringify({ roles, version: member.version }),
      });
      if (!res.ok) throw new Error(`${t("admin.saveFailed")} (${res.status})`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        member
          ? `${t("admin.assignRolesTitle")} · ${member.displayName}`
          : t("admin.assignRolesTitle")
      }
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("catalog.cancel")}
          </Button>
          <Button
            type="button"
            disabled={busy || !member || roles.length === 0}
            onClick={() => void save()}
          >
            {busy ? t("admin.loading") : t("admin.saveRoles")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <p className="text-sm text-muted-foreground">{t("admin.assignRolesHint")}</p>
        <div className="grid gap-1.5">
          <Label>{t("admin.memberRoles")}</Label>
          <RoleChecklist value={roles} onChange={setRoles} disabled={busy} />
        </div>
      </div>
    </Modal>
  );
}
