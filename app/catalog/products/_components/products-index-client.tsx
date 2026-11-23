// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { PageHeader } from "@/app/components/ui/page-header";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";

type ProductRow = {
  id: string;
  name: string;
  categoryId: string;
  isActive: boolean;
  version: number;
  variantCount?: number;
  primarySku?: string | null;
  primaryBarcode?: string | null;
};

type Category = { id: string; name: string; code: string };

export function ProductsIndexClient() {
  const t = useT();
  const [items, setItems] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set("q", q.trim());
      qs.set("limit", "50");
      const [prodRes, catRes] = await Promise.all([
        adminApi(`/api/v1/products?${qs}`),
        adminApi("/api/v1/categories"),
      ]);
      if (prodRes.status === 403 || catRes.status === 403) {
        throw new Error(t("admin.forbidden"));
      }
      if (!prodRes.ok) throw new Error(`${t("admin.loadFailed")} (${prodRes.status})`);
      const prodJson = await prodRes.json();
      const catJson = await catRes.json();
      setItems((prodJson.data as ProductRow[]) ?? []);
      setCategories((catJson.data as Category[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [q, t]);

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
              <Link href="/catalog/products/new">
                <Plus className="h-4 w-4" />
                {t("catalog.createProduct")}
              </Link>
            </Button>
          </div>
        }
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="product-q">{t("catalog.searchPlaceholder")}</Label>
          <Input
            id="product-q"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setQ(qDraft);
            }}
            placeholder={t("catalog.searchPlaceholder")}
          />
        </div>
        <Button type="button" onClick={() => setQ(qDraft)}>
          {t("catalog.search")}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-10">
          <p className="text-sm text-muted-foreground">{t("catalog.emptyProducts")}</p>
          <Button type="button" asChild>
            <Link href="/catalog/products/new">{t("catalog.createProduct")}</Link>
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">{t("catalog.colName")}</th>
                <th className="px-3 py-2.5 font-medium">{t("catalog.colCategory")}</th>
                <th className="px-3 py-2.5 font-medium">{t("catalog.colPrimarySku")}</th>
                <th className="px-3 py-2.5 font-medium">{t("catalog.colVariants")}</th>
                <th className="px-3 py-2.5 font-medium">{t("catalog.colActive")}</th>
                <th className="px-3 py-2.5 font-medium">{t("admin.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b border-border/70 hover:bg-muted/20">
                  <td className="px-3 py-2.5 align-middle">
                    <Link
                      href={`/catalog/products/${row.id}`}
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
                  <td className="px-3 py-2.5 align-middle">{row.variantCount ?? "—"}</td>
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
                      <Link href={`/catalog/products/${row.id}`}>{t("catalog.open")}</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
