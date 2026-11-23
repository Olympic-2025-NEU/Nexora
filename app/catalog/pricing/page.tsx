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

type PriceList = {
  id: string;
  code: string | null;
  name: string;
  isDefault: boolean;
  currency: string;
  isActive: boolean;
  validFrom: string;
  validTo: string | null;
  version: number;
};

type PriceItem = {
  id: string;
  productVariantId: string;
  uomId: string;
  priceType: string;
  amount: string;
  isActive: boolean;
};

type Uom = { id: string; name: string; code: string };
type VariantOpt = { id: string; label: string };

export default function PricingPage() {
  const t = useT();
  const [lists, setLists] = useState<PriceList[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [items, setItems] = useState<PriceItem[]>([]);
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [variants, setVariants] = useState<VariantOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [variantId, setVariantId] = useState("");
  const [uomId, setUomId] = useState("");
  const [priceType, setPriceType] = useState("retail");
  const [amount, setAmount] = useState("");

  const loadLists = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listRes, uomRes, prodRes] = await Promise.all([
        adminApi("/api/v1/price-lists"),
        adminApi("/api/v1/uoms"),
        adminApi("/api/v1/products?limit=50"),
      ]);
      if (listRes.status === 403) throw new Error(t("admin.forbidden"));
      if (!listRes.ok) throw new Error(`${t("admin.loadFailed")} (${listRes.status})`);
      const listJson = await listRes.json();
      const uomJson = await uomRes.json();
      const prodJson = await prodRes.json();
      const nextLists = (listJson.data as PriceList[]) ?? [];
      setLists(nextLists);
      setUoms((uomJson.data as Uom[]) ?? []);
      const defaultList = nextLists.find((l) => l.isDefault) ?? nextLists[0];
      setSelectedId((prev) => prev || defaultList?.id || "");
      setUomId((prev) => prev || (uomJson.data as Uom[])?.[0]?.id || "");

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
      setVariantId((prev) => prev || opts[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadItems = useCallback(async (listId: string) => {
    if (!listId) {
      setItems([]);
      return;
    }
    const res = await adminApi(`/api/v1/price-lists/${listId}/items`);
    if (!res.ok) return;
    const json = await res.json();
    setItems((json.data as PriceItem[]) ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadLists();
    });
    return () => {
      cancelled = true;
    };
  }, [loadLists]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadItems(selectedId);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId, loadItems]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !variantId || !uomId || !amount.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await adminApi(`/api/v1/price-lists/${selectedId}/items`, {
        method: "POST",
        body: JSON.stringify({
          productVariantId: variantId,
          uomId,
          priceType,
          amount: amount.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          `${t("catalog.createFailed")} (${res.status}${json.error ? `: ${json.error}` : ""})`,
        );
      }
      setAmount("");
      await loadItems(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("catalog.createFailed"));
    } finally {
      setAdding(false);
    }
  }

  const selected = lists.find((l) => l.id === selectedId);
  const uomName = (id: string) => uoms.find((u) => u.id === id)?.name ?? id.slice(0, 8);
  const variantLabel = (id: string) =>
    variants.find((v) => v.id === id)?.label ?? id.slice(0, 8);

  return (
    <section className="w-full space-y-6">
      <PageHeader
        title={t("nav.pricing")}
        description={t("catalog.pricingHint")}
        actions={
          <Button type="button" variant="outline" onClick={() => void loadLists()}>
            {t("admin.refresh")}
          </Button>
        }
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("catalog.colName")}</th>
                  <th className="px-3 py-2 font-medium">{t("catalog.colCode")}</th>
                  <th className="px-3 py-2 font-medium">{t("catalog.colCurrency")}</th>
                  <th className="px-3 py-2 font-medium">{t("catalog.colDefault")}</th>
                  <th className="px-3 py-2 font-medium">{t("admin.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {lists.map((l) => (
                  <tr
                    key={l.id}
                    className={`border-b border-border/70 ${selectedId === l.id ? "bg-muted/30" : ""}`}
                  >
                    <td className="px-3 py-2 font-medium">{l.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {l.code ?? t("catalog.generalList")}
                    </td>
                    <td className="px-3 py-2">{l.currency}</td>
                    <td className="px-3 py-2">
                      {l.isDefault ? t("catalog.activeYes") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={selectedId === l.id ? "default" : "secondary"}
                        onClick={() => setSelectedId(l.id)}
                      >
                        {t("catalog.viewItems")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected ? (
            <div className="space-y-4">
              <h2 className="text-base font-semibold">
                {t("catalog.priceItemsTitle")}: {selected.name}
              </h2>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("catalog.emptyPriceItems")}</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[40rem] text-left text-sm">
                    <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">{t("catalog.colVariant")}</th>
                        <th className="px-3 py-2 font-medium">{t("nav.uom")}</th>
                        <th className="px-3 py-2 font-medium">{t("catalog.colPriceType")}</th>
                        <th className="px-3 py-2 font-medium">{t("catalog.colAmount")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.id} className="border-b border-border/70">
                          <td className="px-3 py-2">{variantLabel(it.productVariantId)}</td>
                          <td className="px-3 py-2">{uomName(it.uomId)}</td>
                          <td className="px-3 py-2">{it.priceType}</td>
                          <td className="px-3 py-2 font-mono text-xs">{it.amount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
                <h3 className="mb-4 text-sm font-semibold">{t("catalog.addPriceItem")}</h3>
                <form
                  onSubmit={(e) => void addItem(e)}
                  className="grid gap-4 md:grid-cols-2"
                >
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>{t("catalog.colVariant")}</Label>
                    <Select value={variantId} onValueChange={setVariantId}>
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
                  <div className="space-y-1.5">
                    <Label>{t("nav.uom")}</Label>
                    <Select value={uomId} onValueChange={setUomId}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {uoms.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("catalog.colPriceType")}</Label>
                    <Select value={priceType} onValueChange={setPriceType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="retail">retail</SelectItem>
                        <SelectItem value="wholesale">wholesale</SelectItem>
                        <SelectItem value="purchase">purchase</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="amount">{t("catalog.colAmount")}</Label>
                    <Input
                      id="amount"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="10000"
                      required
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Button
                      type="submit"
                      disabled={adding || !variantId || !uomId || !amount.trim()}
                    >
                      {adding ? t("admin.loading") : t("admin.create")}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
