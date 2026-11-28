// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";
import { SupplierFormModal } from "./supplier-form-modal";
import type { LocalSupplierRow } from "./types";

export function SuppliersIndexClient() {
  const t = useT();
  const [items, setItems] = useState<LocalSupplierRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LocalSupplierRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi("/api/v1/local-suppliers");
      if (res.status === 403) throw new Error(t("admin.forbidden"));
      if (!res.ok) throw new Error(`${t("suppliers.loadFailed")} (${res.status})`);
      setItems(((await res.json()).data as LocalSupplierRow[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("suppliers.loadFailed"));
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

  return (
    <section className="w-full space-y-6">
      <PageHeader
        title={t("suppliers.title")}
        description={t("suppliers.hint")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" asChild>
              <Link href="/trading/inbound">{t("inbound.backToList")}</Link>
            </Button>
            <Button type="button" variant="outline" onClick={() => void load()}>
              {t("admin.refresh")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              {t("suppliers.add")}
            </Button>
          </div>
        }
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("suppliers.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">{t("suppliers.code")}</th>
                <th className="px-3 py-2.5 font-medium">{t("suppliers.displayName")}</th>
                <th className="px-3 py-2.5 font-medium">{t("suppliers.colStatus")}</th>
                <th className="px-3 py-2.5 font-medium">{t("suppliers.contactPhone")}</th>
                <th className="px-3 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b border-border/70">
                  <td className="px-3 py-2.5 font-mono text-xs">{row.code}</td>
                  <td className="px-3 py-2.5 font-medium">{row.displayName}</td>
                  <td className="px-3 py-2.5">
                    {row.status === "active"
                      ? t("suppliers.statusActive")
                      : t("suppliers.statusInactive")}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{row.contactPhone || "—"}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(row);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                      {t("suppliers.edit")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SupplierFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        supplier={editing}
        onSaved={() => void load()}
      />
    </section>
  );
}
