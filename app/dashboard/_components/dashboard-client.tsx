// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";

type SaleLine = {
  id: string;
  batchId: string;
  quantity: string;
  uomId: string;
};

type Sale = {
  id: string;
  documentNumber: string;
  status: string;
  soldAt: string;
  buyerRef: string | null;
  lines: SaleLine[];
};

function formatWhen(iso: string): string {
  const d = Date.parse(iso);
  if (!Number.isFinite(d)) return iso;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(d));
  } catch {
    return iso;
  }
}

export function DashboardClient() {
  const t = useT();
  const [items, setItems] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await adminApi("/api/v1/sales-records");
      if (!response.ok) {
        throw new Error(t("dashboard.loadSalesFailed"));
      }
      const body = (await response.json()) as { data?: Sale[] };
      setItems(Array.isArray(body.data) ? body.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dashboard.loadSalesFailed"));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const recent = useMemo(() => items.slice(0, 8), [items]);

  const topBatches = useMemo(() => {
    const map = new Map<string, number>();
    for (const sale of items) {
      for (const line of sale.lines ?? []) {
        const qty = Number.parseFloat(line.quantity);
        if (!Number.isFinite(qty)) continue;
        map.set(line.batchId, (map.get(line.batchId) ?? 0) + qty);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([batchId, quantity]) => ({ batchId, quantity }));
  }, [items]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("dashboard.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("dashboard.subtitle")}</p>
      </header>

      <section
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        data-purpose="kpi-metrics-grid"
        aria-label={t("dashboard.kpiSection")}
      >
        <article className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("dashboard.revenue")}
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">—</p>
          <p className="mt-2 text-xs text-muted-foreground">{t("dashboard.revenueSoon")}</p>
        </article>
        <article className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("dashboard.recentOrdersCount")}
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
            {loading ? "…" : items.length}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">{t("dashboard.recentOrdersHint")}</p>
        </article>
        <article className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("dashboard.topProducts")}
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
            {loading ? "…" : topBatches.length}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">{t("dashboard.topProductsHint")}</p>
        </article>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">{t("dashboard.recentOrders")}</h2>
            <Link href="/orders" className="text-xs font-medium text-primary hover:underline">
              {t("dashboard.viewAll")}
            </Link>
          </div>
          <div className="px-5 py-3">
            {loading ? (
              <p className="text-sm text-muted-foreground">{t("dashboard.loading")}</p>
            ) : error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("dashboard.emptyOrders")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((sale) => (
                  <li key={sale.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link
                        href={`/orders/${sale.id}`}
                        className="truncate text-sm font-medium text-primary hover:underline"
                      >
                        {sale.documentNumber}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatWhen(sale.soldAt)}
                        {sale.buyerRef ? ` · ${sale.buyerRef}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {sale.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">{t("dashboard.topProducts")}</h2>
          </div>
          <div className="px-5 py-3">
            {loading ? (
              <p className="text-sm text-muted-foreground">{t("dashboard.loading")}</p>
            ) : topBatches.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("dashboard.emptyTopProducts")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {topBatches.map((row) => (
                  <li key={row.batchId} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="truncate font-mono text-xs text-foreground">{row.batchId}</span>
                    <span className="tabular-nums text-sm font-medium">{row.quantity}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">{t("dashboard.topProductsNote")}</p>
          </div>
        </section>
      </div>

      <section id="reports" className="scroll-mt-20 space-y-3">
        <h2 className="text-sm font-semibold">{t("dashboard.featuredTitle")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { titleKey: "dashboard.featuredInventory", bodyKey: "dashboard.featuredInventoryBody" },
            { titleKey: "dashboard.featuredQuality", bodyKey: "dashboard.featuredQualityBody" },
            { titleKey: "dashboard.featuredReports", bodyKey: "dashboard.featuredReportsBody" },
          ].map((box) => (
            <article
              key={box.titleKey}
              className="rounded-lg border border-dashed border-border bg-card/60 p-5"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("dashboard.comingSoon")}
              </p>
              <h3 className="mt-1 text-sm font-semibold text-foreground">{t(box.titleKey)}</h3>
              <p className="mt-2 text-xs text-muted-foreground">{t(box.bodyKey)}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
