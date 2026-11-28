// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Modal } from "@/app/components/ui/modal";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";
import type { MemberRow, MemberStatus } from "./types";
import { statusLabel } from "./types";

type Props = {
  open: boolean;
  onClose: () => void;
  member: MemberRow | null;
  onSaved: () => void;
};

export function MemberEditModal({ open, onClose, member, onSaved }: Props) {
  const t = useT();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !member) return;
    setDisplayName(member.displayName);
    setEmail(member.email ?? "");
    setError(null);
  }, [open, member]);

  async function patch(
    patch: {
      displayName?: string;
      email?: string | null;
      status?: Exclude<MemberStatus, "invited">;
    },
  ) {
    if (!member) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi(`/api/v1/members/${member.id}`, {
        method: "PATCH",
        headers: { "if-match": String(member.version) },
        body: JSON.stringify({ ...patch, version: member.version }),
      });
      if (!res.ok) throw new Error(`${t("admin.saveFailed")} (${res.status})`);
      onSaved();
      if (patch.displayName !== undefined || patch.email !== undefined) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
    if (!displayName.trim()) {
      setError(t("admin.memberNameRequired"));
      return;
    }
    await patch({
      displayName: displayName.trim(),
      email: email.trim() ? email.trim() : null,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("admin.editMemberTitle")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("catalog.cancel")}
          </Button>
          <Button type="button" disabled={busy || !member} onClick={() => void saveProfile()}>
            {busy ? t("admin.loading") : t("admin.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {member ? (
          <p className="text-xs text-muted-foreground">
            {statusLabel(t, member.status)} · v{member.version}
          </p>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="edit-member-name">{t("admin.memberName")}</Label>
          <Input
            id="edit-member-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="edit-member-email">{t("admin.memberEmail")}</Label>
          <Input
            id="edit-member-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {member && (member.status === "invited" || member.status === "disabled") ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void patch({ status: "active" })}
            >
              {t("admin.activate")}
            </Button>
          ) : null}
          {member && member.status !== "disabled" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void patch({ status: "disabled" })}
            >
              {t("admin.disable")}
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
