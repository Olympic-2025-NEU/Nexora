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
import type { LocalSupplierRow } from "./types";

type Props = {
  open: boolean;
  onClose: () => void;
  supplier?: LocalSupplierRow | null;
  onSaved: (row?: LocalSupplierRow) => void;
};

export function SupplierFormModal({ open, onClose, supplier, onSaved }: Props) {
  const t = useT();
  const isEdit = Boolean(supplier);
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("active");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (supplier) {
      setDisplayName(supplier.displayName);
      setCode(supplier.code);
      setContactPhone(supplier.contactPhone ?? "");
      setContactEmail(supplier.contactEmail ?? "");
      setNote(supplier.note ?? "");
      setStatus(supplier.status === "inactive" ? "inactive" : "active");
    } else {
      setDisplayName("");
      setCode("");
      setContactPhone("");
      setContactEmail("");
      setNote("");
      setStatus("active");
    }
  }, [open, supplier]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (!displayName.trim() || !code.trim()) {
        throw new Error(t("suppliers.fillRequired"));
      }
      if (!isEdit) {
        const res = await adminApi("/api/v1/local-suppliers", {
          method: "POST",
          body: JSON.stringify({
            displayName: displayName.trim(),
            code: code.trim(),
            ...(contactPhone.trim() ? { contactPhone: contactPhone.trim() } : {}),
            ...(contactEmail.trim() ? { contactEmail: contactEmail.trim() } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? t("suppliers.createFailed"));
        }
        const created = (await res.json()).data as LocalSupplierRow;
        onSaved(created);
      } else if (supplier) {
        const res = await adminApi(`/api/v1/local-suppliers/${supplier.id}`, {
          method: "PATCH",
          headers: { "If-Match": String(supplier.version) },
          body: JSON.stringify({
            displayName: displayName.trim(),
            status,
            contactPhone: contactPhone.trim() || null,
            contactEmail: contactEmail.trim() || null,
            note: note.trim() || null,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? t("suppliers.saveFailed"));
        }
        onSaved((await res.json()).data as LocalSupplierRow);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("suppliers.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t("suppliers.editTitle") : t("suppliers.createTitle")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("catalog.cancel")}
          </Button>
          <Button type="button" disabled={busy} onClick={() => void save()}>
            {isEdit ? t("suppliers.save") : t("suppliers.add")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <p className="text-sm text-muted-foreground">
          {isEdit ? t("suppliers.editHint") : t("suppliers.createHint")}
        </p>
        <div className="grid gap-1.5">
          <Label htmlFor="modal-supplier-name">{t("suppliers.displayName")}</Label>
          <Input
            id="modal-supplier-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="modal-supplier-code">{t("suppliers.code")}</Label>
          <Input
            id="modal-supplier-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={isEdit}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="modal-supplier-phone">{t("suppliers.contactPhone")}</Label>
          <Input
            id="modal-supplier-phone"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="modal-supplier-email">{t("suppliers.contactEmail")}</Label>
          <Input
            id="modal-supplier-email"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="modal-supplier-note">{t("suppliers.note")}</Label>
          <Input
            id="modal-supplier-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {isEdit ? (
          <div className="grid gap-1.5">
            <Label>{t("suppliers.colStatus")}</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t("suppliers.statusActive")}</SelectItem>
                <SelectItem value="inactive">{t("suppliers.statusInactive")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
