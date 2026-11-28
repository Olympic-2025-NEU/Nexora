// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Store } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { ListFilters, type FilterField } from "@/app/components/ui/list-filters";
import { PageHeader } from "@/app/components/ui/page-header";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";

type OrderRow = {
  id: string;
  orderNumber: string;
  status: string;
  version: number;
  totalAmount: string;
  currency: string;
  soldAt: string;
  linkedIssueId: string | null;
  lines: { id: string; quantity: string }[];
  qrPath: string | null;
};

const EMPTY_FILTERS: Record<string, string> = { q: "", status: "" };

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

function formatMoney(amount: string, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "VND",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${amount} ${currency}`;
  }
}

function statusTone(status: string): string {
  switch (status) {
    case "fulfilled":
      return "text-emerald-700 dark:text-emerald-400";
    case "paid":
      return "text-sky-700 dark:text-sky-400";
    case "draft":
      return "text-amber-700 dark:text-amber-400";
    case "cancelled":
      return "text-muted-foreground line-through";
    default:
      return "text-foreground";
  }
}

function statusLabel(status: string, t: (key: string) => string): string {
  if (status === "draft") return t("orders.statusDraft");
  if (status === "paid") return t("orders.statusPaid");
  if (status === "fulfilled") return t("orders.statusFulfilled");
  if (status === "cancelled") return t("orders.statusCancelled");
  return status;
}

export function OrdersIndexClient() {
  const t = useT();
  const [items, setItems] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>(EMPTY_FILTERS);

  const filterFields = useMemo<FilterField[]>(
    () => [
      {
        type: "search",
        key: "q",
        label: t("filters.search"),
        placeholder: t("orders.searchPlaceholder"),
      },
      {
        type: "select",
        key: "status",
        label: t("trading.status"),
        placeholder: t("trading.allStatuses"),
        options: [
          { value: "draft", label: t("orders.statusDraft") },
          { value: "paid", label: t("orders.statusPaid") },
          { value: "fulfilled", label: t("orders.statusFulfilled") },
          { value: "cancelled", label: t("orders.statusCancelled") },
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
      if (filters.status) qs.set("status", filters.status);
      if (filters.q.trim()) qs.set("q", filters.q.trim());
      const res = await adminApi(`/api/v1/orders${qs.toString() ? `?${qs}` : ""}`);
      if (res.status === 403) throw new Error(t("admin.forbidden"));
      if (!res.ok) throw new Error(`${t("admin.loadFailed")} (${res.status})`);
      const json = await res.json();
      setItems((json.data as OrderRow[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [filters.q, filters.status, t]);

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
        title={t("orders.title")}
        description={t("orders.indexHint")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void load()}>
              {t("admin.refresh")}
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href="/pos">
                <Store className="h-4 w-4" />
                {t("orders.openPos")}
              </Link>
            </Button>
            <Button type="button" asChild>
              <Link href="/pos">
                <Plus className="h-4 w-4" />
                {t("orders.create")}
              </Link>
            </Button>
          </div>
        }
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-48 xl:w-52">
          <ListFilters
            layout="sidebar"
            title={t("filters.panelTitle")}
            fields={filterFields}
            values={filters}
            onApply={setFilters}
            applyLabel={t("filters.apply")}
            clearLabel={t("filters.clear")}
          />
        </aside>

        <div className="min-w-0 flex-1">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-10">
              <p className="text-sm text-muted-foreground">{t("orders.empty")}</p>
              <Button type="button" asChild>
                <Link href="/pos">{t("orders.openPos")}</Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[48rem] text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">{t("orders.colNumber")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("orders.colStatus")}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t("orders.colTotal")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("orders.colSoldAt")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("orders.colTrace")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("admin.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id} className="border-b border-border/70 hover:bg-muted/20">
                      <td className="px-3 py-2.5 align-middle">
                        <Link
                          href={`/orders/${row.id}`}
                          className="font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {row.orderNumber}
                        </Link>
                      </td>
                      <td className={`px-3 py-2.5 align-middle ${statusTone(row.status)}`}>
                        {statusLabel(row.status, t)}
                      </td>
                      <td className="px-3 py-2.5 align-middle text-right tabular-nums">
                        {formatMoney(row.totalAmount, row.currency)}
                      </td>
                      <td className="px-3 py-2.5 align-middle text-muted-foreground">
                        {formatWhen(row.soldAt)}
                      </td>
                      <td className="px-3 py-2.5 align-middle font-mono text-xs text-muted-foreground">
                        {row.qrPath ? t("orders.hasQr") : "—"}
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <Button type="button" size="sm" variant="secondary" asChild>
                          <Link href={`/orders/${row.id}`}>{t("orders.open")}</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
