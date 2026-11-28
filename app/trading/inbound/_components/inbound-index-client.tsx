// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { ListFilters, type FilterField } from "@/app/components/ui/list-filters";
import { PageHeader } from "@/app/components/ui/page-header";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";

type InboundRow = {
  id: string;
  documentNumber: string;
  sourceKind: "local" | "nexora";
  status: string;
  counterpartyLabel: string | null;
  createdAt: string;
  confirmedAt: string | null;
  href: string;
};

const EMPTY_FILTERS: Record<string, string> = { q: "", sourceKind: "", status: "" };

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(d);
  } catch {
    return iso;
  }
}

function statusLabel(status: string, t: (key: string) => string): string {
  if (status === "draft") return t("inbound.statusDraft");
  if (status === "confirmed") return t("inbound.statusConfirmed");
  if (status === "cancelled") return t("inbound.statusCancelled");
  return status;
}

export function InboundIndexClient() {
  const t = useT();
  const [items, setItems] = useState<InboundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>(EMPTY_FILTERS);

  const filterFields = useMemo<FilterField[]>(
    () => [
      {
        type: "search",
        key: "q",
        label: t("filters.search"),
        placeholder: t("inbound.searchPlaceholder"),
      },
      {
        type: "select",
        key: "sourceKind",
        label: t("inbound.colSource"),
        placeholder: t("inbound.allSources"),
        options: [
          { value: "local", label: t("inbound.sourceLocal") },
          { value: "nexora", label: t("inbound.sourceNexora") },
        ],
      },
      {
        type: "select",
        key: "status",
        label: t("trading.status"),
        placeholder: t("trading.allStatuses"),
        options: [
          { value: "draft", label: t("inbound.statusDraft") },
          { value: "confirmed", label: t("inbound.statusConfirmed") },
          { value: "cancelled", label: t("inbound.statusCancelled") },
        ],
      },
    ],
    [t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (filters.sourceKind) qs.set("sourceKind", filters.sourceKind);
      if (filters.status) qs.set("status", filters.status);
      if (filters.q.trim()) qs.set("q", filters.q.trim());
      const res = await adminApi(`/api/v1/inbound${qs.toString() ? `?${qs}` : ""}`);
      if (res.status === 403) throw new Error(t("admin.forbidden"));
      if (!res.ok) throw new Error(`${t("inbound.loadFailed")} (${res.status})`);
      setItems(((await res.json()).data as InboundRow[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("inbound.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [filters, t]);

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
        title={t("inbound.title")}
        description={t("inbound.hint")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" asChild>
              <Link href="/trading/suppliers">{t("suppliers.title")}</Link>
            </Button>
            <Button type="button" asChild>
              <Link href="/trading/inbound/new">
                <Plus className="h-4 w-4" />
                {t("inbound.create")}
              </Link>
            </Button>
          </div>
        }
      />

      <ListFilters
        fields={filterFields}
        values={filters}
        onApply={setFilters}
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("inbound.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">{t("inbound.colNumber")}</th>
                <th className="px-3 py-2.5 font-medium">{t("inbound.colSource")}</th>
                <th className="px-3 py-2.5 font-medium">{t("inbound.colCounterparty")}</th>
                <th className="px-3 py-2.5 font-medium">{t("inbound.colStatus")}</th>
                <th className="px-3 py-2.5 font-medium">{t("inbound.colCreated")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={`${row.sourceKind}-${row.id}`} className="border-b border-border/70">
                  <td className="px-3 py-2.5">
                    <Link className="font-medium underline-offset-2 hover:underline" href={row.href}>
                      {row.documentNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    {row.sourceKind === "local"
                      ? t("inbound.sourceLocal")
                      : t("inbound.sourceNexora")}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {row.counterpartyLabel || "—"}
                  </td>
                  <td className="px-3 py-2.5">{statusLabel(row.status, t)}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{formatWhen(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
