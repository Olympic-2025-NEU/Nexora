// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { PageHeader } from "@/app/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";

type Batch = {
  id: string;
  productId: string;
  productVariantId: string;
  localCode: string;
  qualityStatus: string;
  version: number;
  originLot?: { issuerInstanceId: string; lotId: string };
};

type VariantOpt = { id: string; label: string };

export default function CatalogBatchesPage() {
  const t = useT();
  const [items, setItems] = useState<Batch[]>([]);
  const [variants, setVariants] = useState<VariantOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productVariantId, setProductVariantId] = useState("");
  const [localCode, setLocalCode] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [batchRes, prodRes] = await Promise.all([
        adminApi("/api/v1/batches"),
        adminApi("/api/v1/products?limit=50"),
      ]);
      if (batchRes.status === 403) throw new Error(t("admin.forbidden"));
      if (!batchRes.ok) throw new Error(`${t("admin.loadFailed")} (${batchRes.status})`);
      const batchJson = await batchRes.json();
      setItems((batchJson.data as Batch[]) ?? []);

      const prodJson = await prodRes.json();
      const products = (prodJson.data as { id: string; name: string }[]) ?? [];
      const opts: VariantOpt[] = [];
      for (const p of products.slice(0, 20)) {
        const vRes = await adminApi(`/api/v1/products/${p.id}/variants`);
        if (!vRes.ok) continue;
        const vJson = await vRes.json();
        for (const v of (vJson.data as { id: string; sku: string | null; barcode: string | null }[]) ??
          []) {
          opts.push({
            id: v.id,
            label: `${p.name} · ${v.sku || v.barcode || v.id.slice(0, 8)}`,
          });
        }
      }
      setVariants(opts);
      setProductVariantId((prev) => prev || opts[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.loadFailed"));
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

  async function createBatch(e: React.FormEvent) {
    e.preventDefault();
    if (!productVariantId || !localCode.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await adminApi("/api/v1/batches", {
        method: "POST",
        body: JSON.stringify({
          productVariantId,
          localCode: localCode.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          `${t("catalog.createFailed")} (${res.status}${json.error ? `: ${json.error}` : ""})`,
        );
      }
      setLocalCode("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("catalog.createFailed"));
    } finally {
      setCreating(false);
    }
  }

  const variantLabel = (id: string) =>
    variants.find((v) => v.id === id)?.label ?? id.slice(0, 8);

  return (
    <section className="w-full space-y-6">
      <PageHeader
        title={t("admin.batchesTitle")}
        description={t("catalog.batchesHint")}
        actions={
          <Button type="button" variant="outline" onClick={() => void load()}>
            {t("admin.refresh")}
          </Button>
        }
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("catalog.colLocalCode")}</th>
                <th className="px-3 py-2 font-medium">{t("catalog.colVariant")}</th>
                <th className="px-3 py-2 font-medium">{t("catalog.colQuality")}</th>
                <th className="px-3 py-2 font-medium">{t("admin.orgVersion")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id} className="border-b border-border/70">
                  <td className="px-3 py-2 font-medium">{b.localCode}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {variantLabel(b.productVariantId)}
                  </td>
                  <td className="px-3 py-2">{b.qualityStatus}</td>
                  <td className="px-3 py-2">v{b.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
        <h2 className="mb-4 text-base font-semibold">{t("catalog.createBatch")}</h2>
        <form onSubmit={(e) => void createBatch(e)} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label>{t("catalog.colVariant")}</Label>
            <Select value={productVariantId} onValueChange={setProductVariantId}>
              <SelectTrigger>
                <SelectValue placeholder={t("catalog.colVariant")} />
              </SelectTrigger>
              <SelectContent>
                {variants.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="local-code">{t("catalog.colLocalCode")}</Label>
            <Input
              id="local-code"
              value={localCode}
              onChange={(e) => setLocalCode(e.target.value)}
              required
            />
          </div>
          <div className="md:col-span-2">
            <Button
              type="submit"
              disabled={creating || !productVariantId || !localCode.trim()}
            >
              {creating ? t("admin.loading") : t("admin.create")}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
