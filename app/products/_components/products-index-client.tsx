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
import { filtersToSearchParams } from "@/app/lib/filter-params";
import { ProductThumb } from "./product-thumb";

type ProductRow = {
  id: string;
  name: string;
  categoryId: string;
  isActive: boolean;
  version: number;
  primarySku?: string | null;
  primaryBarcode?: string | null;
  baseUomName?: string | null;
  pricePurchase?: string | null;
  priceRetail?: string | null;
  priceWholesale?: string | null;
  primaryImageAttachmentId?: string | null;
};

type Category = { id: string; name: string; code: string };

const EMPTY_FILTERS: Record<string, string> = { q: "", categoryId: "" };

function formatMoney(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  try {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 3,
      minimumFractionDigits: 0,
    }).format(n);
  } catch {
    return value;
  }
}

export function ProductsIndexClient() {
  const t = useT();
  const [items, setItems] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>(EMPTY_FILTERS);

  const filterFields = useMemo<FilterField[]>(
    () => [
      {
        type: "search",
        key: "q",
        label: t("filters.search"),
        placeholder: t("catalog.searchPlaceholder"),
      },
      {
        type: "combobox",
        key: "categoryId",
        label: t("catalog.colCategory"),
        placeholder: t("filters.allCategories"),
        searchPlaceholder: t("filters.searchCategory"),
        emptyLabel: t("filters.allCategories"),
        options: categories.map((c) => ({
          value: c.id,
          label: c.name,
          keywords: c.code,
        })),
      },
    ],
    [categories, t],
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      void (async () => {
        try {
          const catRes = await adminApi("/api/v1/categories");
          if (cancelled) return;
          if (catRes.status === 403) throw new Error(t("admin.forbidden"));
          if (!catRes.ok) throw new Error(`${t("admin.loadFailed")} (${catRes.status})`);
          const catJson = await catRes.json();
          setCategories((catJson.data as Category[]) ?? []);
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : t("admin.loadFailed"));
          }
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = filtersToSearchParams(filters);
      qs.set("limit", "50");
      const prodRes = await adminApi(`/api/v1/products?${qs}`);
      if (prodRes.status === 403) throw new Error(t("admin.forbidden"));
      if (!prodRes.ok) throw new Error(`${t("admin.loadFailed")} (${prodRes.status})`);
      const prodJson = await prodRes.json();
      setItems((prodJson.data as ProductRow[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.loadFailed"));
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

  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <section className="w-full space-y-6">
      <PageHeader
        title={t("admin.productsTitle")}
        description={t("catalog.productsIndexHint")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void load()}>
              {t("admin.refresh")}
            </Button>
            <Button type="button" asChild>
              <Link href="/products/new">
                <Plus className="h-4 w-4" />
                {t("catalog.createProduct")}
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
              <p className="text-sm text-muted-foreground">{t("catalog.emptyProducts")}</p>
              <Button type="button" asChild>
                <Link href="/products/new">{t("catalog.createProduct")}</Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="w-12 px-3 py-2.5 font-medium">
                      <span className="sr-only">{t("catalog.colImage")}</span>
                    </th>
                    <th className="px-3 py-2.5 font-medium">{t("catalog.colName")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("catalog.colCategory")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("catalog.colPrimarySku")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("catalog.colUom")}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t("catalog.pricePurchase")}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t("catalog.priceRetail")}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t("catalog.priceWholesale")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("catalog.colActive")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("admin.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id} className="border-b border-border/70 hover:bg-muted/20">
                      <td className="px-3 py-2.5 align-middle">
                        <Link href={`/products/${row.id}`} className="inline-flex">
                          <ProductThumb
                            attachmentId={row.primaryImageAttachmentId}
                            alt={row.name}
                          />
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <Link
                          href={`/products/${row.id}`}
                          className="font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 align-middle text-muted-foreground">
                        {catName(row.categoryId)}
                      </td>
                      <td className="px-3 py-2.5 align-middle font-mono text-xs">
                        {row.primarySku || row.primaryBarcode || "—"}
                      </td>
                      <td className="px-3 py-2.5 align-middle">{row.baseUomName || "—"}</td>
                      <td className="px-3 py-2.5 align-middle text-right tabular-nums">
                        {formatMoney(row.pricePurchase)}
                      </td>
                      <td className="px-3 py-2.5 align-middle text-right tabular-nums">
                        {formatMoney(row.priceRetail)}
                      </td>
                      <td className="px-3 py-2.5 align-middle text-right tabular-nums">
                        {formatMoney(row.priceWholesale)}
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <span
                          className={
                            row.isActive
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-muted-foreground"
                          }
                        >
                          {row.isActive ? t("catalog.activeYes") : t("catalog.activeNo")}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <Button type="button" size="sm" variant="secondary" asChild>
                          <Link href={`/products/${row.id}`}>{t("catalog.open")}</Link>
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
