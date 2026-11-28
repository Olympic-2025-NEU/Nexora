// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Modal } from "@/app/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";
import type { PartnerRow } from "./types";

type Props = {
  open: boolean;
  onClose: () => void;
  partner?: PartnerRow | null;
  onSaved: () => void;
};

export function PartnerFormModal({ open, onClose, partner, onSaved }: Props) {
  const t = useT();
  const isEdit = Boolean(partner);
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [systemId, setSystemId] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [status, setStatus] = useState("active");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (partner) {
      setDisplayName(partner.displayName);
      setCode(partner.code);
      setSystemId(partner.issuerInstanceId);
      setStatus(partner.status === "suspended" ? "suspended" : "active");
      setContactEmail(partner.contactEmail ?? "");
    } else {
      setDisplayName("");
      setCode("");
      setSystemId("");
      setContactEmail("");
      setStatus("active");
    }
  }, [open, partner]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (!displayName.trim() || !code.trim() || (!isEdit && !systemId.trim())) {
        throw new Error(t("partners.fillRequired"));
      }
      if (!isEdit) {
        const res = await adminApi("/api/v1/partners", {
          method: "POST",
          body: JSON.stringify({
            displayName: displayName.trim(),
            code: code.trim(),
            issuerInstanceId: systemId.trim(),
            ...(contactEmail.trim() ? { contactEmail: contactEmail.trim() } : {}),
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? t("partners.createFailed"));
        }
      } else if (partner) {
        const res = await adminApi(`/api/v1/partners/${partner.id}`, {
          method: "PATCH",
          headers: { "If-Match": `"${partner.version}"` },
          body: JSON.stringify({
            displayName: displayName.trim(),
            status,
            version: partner.version,
            ...(contactEmail.trim() ? { contactEmail: contactEmail.trim() } : {}),
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? t("partners.saveFailed"));
        }
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partners.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t("partners.editTitle") : t("partners.createTitle")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("catalog.cancel")}
          </Button>
          <Button type="button" disabled={busy} onClick={() => void save()}>
            {isEdit ? t("partners.savePartner") : t("partners.add")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <p className="text-sm text-muted-foreground">
          {isEdit ? t("partners.editHint") : t("partners.createHint")}
        </p>
        <div className="grid gap-1.5">
          <Label htmlFor="modal-partner-name">{t("partners.displayName")}</Label>
          <Input
            id="modal-partner-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="modal-partner-code">{t("partners.code")}</Label>
          <Input
            id="modal-partner-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={isEdit}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="modal-partner-system">{t("partners.systemId")}</Label>
          <Input
            id="modal-partner-system"
            value={systemId}
            onChange={(e) => setSystemId(e.target.value)}
            disabled={isEdit}
          />
          <p className="text-xs text-muted-foreground">{t("partners.systemIdHint")}</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="modal-partner-email">{t("partners.contactEmail")}</Label>
          <Input
            id="modal-partner-email"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </div>
        {isEdit ? (
          <div className="grid gap-1.5">
            <Label>{t("partners.colStatus")}</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t("partners.statusActive")}</SelectItem>
                <SelectItem value="suspended">{t("partners.statusSuspended")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
