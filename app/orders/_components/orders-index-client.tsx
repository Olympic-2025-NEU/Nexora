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
import { cn } from "@/app/lib/cn";

type OrderRow = {
  id: string;
  orderNumber: string;
  status: string;
  version: number;
  currency: string;
  subtotalAmount: string;
  discountAmount: string;
  totalAmount: string;
  paidAmount: string;
  soldAt: string;
  sellerDisplayName?: string | null;
  customerDisplayName?: string | null;
  customerCode?: string | null;
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
    return new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour12: false,
    })
      .format(d)
      .replace(",", "");
  } catch {
    return iso;
  }
}

function formatAmount(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  try {
    return new Intl.NumberFormat("vi-VN", {
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return amount;
  }
}

function debtAmount(total: string, paid: string): number {
  const t = Number(total);
  const p = Number(paid);
  if (!Number.isFinite(t) || !Number.isFinite(p)) return 0;
  return Math.max(0, t - p);
}

function isFullyPaid(row: OrderRow): boolean {
  const total = Number(row.totalAmount);
  const paid = Number(row.paidAmount);
  if (!Number.isFinite(total) || !Number.isFinite(paid)) return false;
  return paid + 1e-9 >= total && total > 0;
}

function StatusBadges({
  row,
  t,
}: {
  row: OrderRow;
  t: (key: string) => string;
}) {
  if (row.status === "cancelled") {
    return (
      <span className="inline-flex rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {t("orders.statusCancelled")}
      </span>
    );
  }
  if (row.status === "draft") {
    return (
      <span className="inline-flex rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
        {t("orders.statusDraft")}
      </span>
    );
  }

  const sold =
    row.status === "fulfilled" || row.status === "paid" || row.status === "confirmed";
  return (
    <div className="flex flex-wrap gap-1.5">
      {sold ? (
        <span className="inline-flex rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
          {t("orders.statusSold")}
        </span>
      ) : null}
      {isFullyPaid(row) ? (
        <span className="inline-flex rounded-md bg-teal-500/15 px-2 py-0.5 text-xs font-medium text-teal-800 dark:text-teal-300">
          {t("orders.statusCollected")}
        </span>
      ) : Number(row.paidAmount) > 0 ? (
        <span className="inline-flex rounded-md bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-800 dark:text-sky-300">
          {t("orders.statusPartialPaid")}
        </span>
      ) : null}
    </div>
  );
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
              <table className="w-full min-w-[72rem] text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">{t("orders.colNumber")}</th>
                    <th className="px-3 py-2.5 font-semibold">{t("orders.colTime")}</th>
                    <th className="px-3 py-2.5 font-semibold">{t("orders.colCustomer")}</th>
                    <th className="px-3 py-2.5 font-semibold">{t("orders.colSeller")}</th>
                    <th className="px-3 py-2.5 text-right font-semibold">{t("orders.colGoodsTotal")}</th>
                    <th className="px-3 py-2.5 text-right font-semibold">{t("orders.colDiscount")}</th>
                    <th className="px-3 py-2.5 text-right font-semibold">{t("orders.colAfterDiscount")}</th>
                    <th className="px-3 py-2.5 text-right font-semibold">{t("orders.colPaid")}</th>
                    <th className="px-3 py-2.5 text-right font-semibold">{t("orders.colDebt")}</th>
                    <th className="px-3 py-2.5 font-semibold">{t("orders.colStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => {
                    const debt = debtAmount(row.totalAmount, row.paidAmount);
                    const discount = Number(row.discountAmount);
                    return (
                      <tr key={row.id} className="border-b border-border/70 hover:bg-muted/20">
                        <td className="px-3 py-2.5 align-middle">
                          <Link
                            href={`/orders/${row.id}`}
                            className="font-medium text-orange-700 hover:underline dark:text-orange-400"
                          >
                            {row.orderNumber}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 align-middle whitespace-nowrap text-muted-foreground">
                          {formatWhen(row.soldAt)}
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          {row.customerDisplayName || t("orders.walkInCustomer")}
                        </td>
                        <td className="px-3 py-2.5 align-middle text-muted-foreground">
                          {row.sellerDisplayName || "—"}
                        </td>
                        <td className="px-3 py-2.5 align-middle text-right tabular-nums">
                          {formatAmount(row.subtotalAmount)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 align-middle text-right tabular-nums",
                            discount > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
                          )}
                        >
                          {formatAmount(row.discountAmount)}
                        </td>
                        <td className="px-3 py-2.5 align-middle text-right tabular-nums">
                          {formatAmount(row.totalAmount)}
                        </td>
                        <td className="px-3 py-2.5 align-middle text-right tabular-nums">
                          {formatAmount(row.paidAmount)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 align-middle text-right tabular-nums",
                            debt > 0 ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {formatAmount(String(debt))}
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <StatusBadges row={row} t={t} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
