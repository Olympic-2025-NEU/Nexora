// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Pencil, Plus } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";
import { PartnerFormModal } from "./partner-form-modal";
import { PartnerGuide } from "./partner-guide";
import { PartnerLinkModal } from "./partner-link-modal";
import { PartnerLinkMonitoring } from "./partner-link-monitoring";
import type { PartnerRow } from "./types";

export type { PartnerRow };

function linkLabel(
  t: (key: string) => string,
  connectionStatus?: string | null,
): string {
  if (!connectionStatus) return t("partners.linkMissing");
  if (connectionStatus === "active") return t("partners.linkActive");
  if (connectionStatus === "disabled") return t("partners.linkDisabled");
  if (connectionStatus === "rotating") return t("partners.linkRotating");
  return connectionStatus;
}

function statusLabel(t: (key: string) => string, status: string): string {
  if (status === "active") return t("partners.statusActive");
  if (status === "suspended") return t("partners.statusSuspended");
  return status;
}

export function PartnersIndexClient() {
  const t = useT();
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PartnerRow | null>(null);
  const [linkPartner, setLinkPartner] = useState<PartnerRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi("/api/v1/partners");
      if (res.status === 403) throw new Error(t("partners.forbidden"));
      if (!res.ok) throw new Error(`${t("partners.loadFailed")} (${res.status})`);
      const json = await res.json();
      setPartners((json.data as PartnerRow[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partners.loadFailed"));
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

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(partner: PartnerRow) {
    setEditing(partner);
    setFormOpen(true);
  }

  return (
    <section className="w-full space-y-6">
      <PageHeader
        title={t("partners.title")}
        description={t("partners.hint")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void load()}>
              {t("admin.refresh")}
            </Button>
            <Button type="button" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("partners.add")}
            </Button>
          </div>
        }
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>
          ) : partners.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-10">
              <p className="text-sm text-muted-foreground">{t("partners.empty")}</p>
              <Button type="button" onClick={openCreate}>
                {t("partners.add")}
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">{t("partners.colCode")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("partners.colName")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("partners.colSystemId")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("partners.colStatus")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("partners.colLink")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("admin.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {partners.map((p) => (
                    <tr key={p.id} className="border-b border-border/70 hover:bg-muted/20">
                      <td className="px-3 py-2.5 font-mono text-xs">{p.code}</td>
                      <td className="px-3 py-2.5 font-medium">{p.displayName}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                        {p.issuerInstanceId}
                      </td>
                      <td className="px-3 py-2.5">{statusLabel(t, p.status)}</td>
                      <td className="px-3 py-2.5">{linkLabel(t, p.connectionStatus)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => openEdit(p)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            {t("partners.edit")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setLinkPartner(p)}
                          >
                            <Link2 className="h-3.5 w-3.5" />
                            {t("partners.configureLink")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <PartnerLinkMonitoring />
        </div>
        <div className="w-full shrink-0 lg:w-80 xl:w-96">
          <PartnerGuide />
        </div>
      </div>

      <PartnerFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        partner={editing}
        onSaved={() => void load()}
      />
      <PartnerLinkModal
        open={Boolean(linkPartner)}
        onClose={() => setLinkPartner(null)}
        partner={linkPartner}
        onSaved={() => void load()}
      />
    </section>
  );
}
