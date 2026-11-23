// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImageIcon, ScanBarcode } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";
import { cn } from "@/app/lib/cn";
import { suggestBarcode, suggestSku } from "../_lib/codes";

type Category = { id: string; name: string; code: string };
type Uom = { id: string; name: string; code: string; isSystemDefault?: boolean };
type Variant = {
  id: string;
  sku: string | null;
  barcode: string | null;
  isPrimary: boolean;
  isActive: boolean;
  version: number;
};
type PriceList = { id: string; name: string; isDefault: boolean; currency: string };
type PriceItem = {
  id: string;
  productVariantId: string;
  uomId: string;
  priceType: string;
  amount: string;
};
type ConversionRow = {
  key: string;
  uomId: string;
  factor: string;
  barcode: string;
  purchase: string;
  retail: string;
  wholesale: string;
};

type AttrBag = {
  brand: string;
  origin: string;
  description: string;
  baseUomId: string;
  costPrice: string;
  purchase: string;
  retail: string;
  wholesale: string;
  conversions: ConversionRow[];
};

type TabId = "general" | "inventory" | "sales";

function attrStr(attrs: Record<string, unknown>, key: string): string {
  const v = attrs[key];
  return typeof v === "string" ? v : "";
}

function parseAttrs(raw: Record<string, unknown> | undefined): AttrBag {
  const attrs = raw ?? {};
  const prices =
    attrs.prices && typeof attrs.prices === "object" && !Array.isArray(attrs.prices)
      ? (attrs.prices as Record<string, unknown>)
      : {};
  const conversionsRaw = Array.isArray(attrs.conversionUoms) ? attrs.conversionUoms : [];
  const conversions: ConversionRow[] = conversionsRaw
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map((row, i) => ({
      key: `c-${i}-${String(row.uomId ?? i)}`,
      uomId: typeof row.uomId === "string" ? row.uomId : "",
      factor: row.factor != null ? String(row.factor) : "1",
      barcode: typeof row.barcode === "string" ? row.barcode : "",
      purchase: row.purchase != null ? String(row.purchase) : "",
      retail: row.retail != null ? String(row.retail) : "",
      wholesale: row.wholesale != null ? String(row.wholesale) : "",
    }));
  return {
    brand: attrStr(attrs, "brand"),
    origin: attrStr(attrs, "origin"),
    description: attrStr(attrs, "description"),
    baseUomId: attrStr(attrs, "baseUomId"),
    costPrice: attrs.costPrice != null ? String(attrs.costPrice) : "0",
    purchase: prices.purchase != null ? String(prices.purchase) : "",
    retail: prices.retail != null ? String(prices.retail) : "",
    wholesale: prices.wholesale != null ? String(prices.wholesale) : "",
    conversions,
  };
}

function buildAttributes(form: AttrBag, isActive: boolean): Record<string, unknown> {
  return {
    brand: form.brand.trim() || undefined,
    origin: form.origin.trim() || undefined,
    description: form.description.trim() || undefined,
    baseUomId: form.baseUomId || undefined,
    costPrice: form.costPrice.trim() || "0",
    prices: {
      purchase: form.purchase.trim() || undefined,
      retail: form.retail.trim() || undefined,
      wholesale: form.wholesale.trim() || undefined,
    },
    conversionUoms: form.conversions
      .filter((c) => c.uomId)
      .map((c) => ({
        uomId: c.uomId,
        factor: c.factor.trim() || "1",
        barcode: c.barcode.trim() || undefined,
        purchase: c.purchase.trim() || undefined,
        retail: c.retail.trim() || undefined,
        wholesale: c.wholesale.trim() || undefined,
      })),
    isActiveHint: isActive,
  };
}

function formatDt(iso: string | undefined, locale: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ProductEditor({ productId }: { productId?: string }) {
  const t = useT();
  const router = useRouter();
  const isCreate = !productId;

  const [tab, setTab] = useState<TabId>("general");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [stockQty, setStockQty] = useState<string>("0");

  const [version, setVersion] = useState(1);
  const [createdAt, setCreatedAt] = useState<string | undefined>();
  const [updatedAt, setUpdatedAt] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [primaryVariant, setPrimaryVariant] = useState<Variant | null>(null);
  const [attrs, setAttrs] = useState<AttrBag>(() => parseAttrs({}));

  const defaultPriceList = useMemo(
    () => priceLists.find((l) => l.isDefault) ?? priceLists[0] ?? null,
    [priceLists],
  );
  const baseUom = useMemo(
    () => uoms.find((u) => u.id === attrs.baseUomId) ?? uoms.find((u) => u.isSystemDefault) ?? uoms[0],
    [uoms, attrs.baseUomId],
  );

  const localeTag = typeof document !== "undefined" ? document.documentElement.lang || "vi" : "vi";

  const loadMasters = useCallback(async () => {
    const [catRes, uomRes, plRes] = await Promise.all([
      adminApi("/api/v1/categories"),
      adminApi("/api/v1/uoms"),
      adminApi("/api/v1/price-lists"),
    ]);
    if (catRes.status === 403 || uomRes.status === 403) {
      throw new Error(t("admin.forbidden"));
    }
    if (!catRes.ok) throw new Error(`${t("admin.loadFailed")} (${catRes.status})`);
    const cats = ((await catRes.json()).data as Category[]) ?? [];
    const uomList = ((await uomRes.json()).data as Uom[]) ?? [];
    const lists = plRes.ok ? (((await plRes.json()).data as PriceList[]) ?? []) : [];
    setCategories(cats);
    setUoms(uomList);
    setPriceLists(lists);
    return { cats, uomList, lists };
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { cats, uomList, lists } = await loadMasters();
      const defaultUom =
        uomList.find((u) => u.isSystemDefault) ?? uomList.find((u) => u.name === "CÁI") ?? uomList[0];

      if (isCreate) {
        setCategoryId(cats[0]?.id ?? "");
        setAttrs((prev) => ({
          ...prev,
          baseUomId: prev.baseUomId || defaultUom?.id || "",
        }));
        setLoading(false);
        return;
      }

      const [pRes, vRes, balRes] = await Promise.all([
        adminApi(`/api/v1/products/${productId}`),
        adminApi(`/api/v1/products/${productId}/variants`),
        adminApi(`/api/v1/inventory/balances?productId=${productId}&limit=100`),
      ]);
      if (pRes.status === 403) throw new Error(t("admin.forbidden"));
      if (!pRes.ok) throw new Error(`${t("admin.loadFailed")} (${pRes.status})`);
      const product = (await pRes.json()).data as {
        id: string;
        name: string;
        categoryId: string;
        isActive: boolean;
        version: number;
        attributes?: Record<string, unknown>;
        createdAt?: string;
        updatedAt?: string;
      };
      const variantList = vRes.ok ? (((await vRes.json()).data as Variant[]) ?? []) : [];
      const primary = variantList.find((v) => v.isPrimary) ?? variantList[0] ?? null;

      setName(product.name);
      setCategoryId(product.categoryId);
      setIsActive(product.isActive);
      setVersion(product.version);
      setCreatedAt(product.createdAt);
      setUpdatedAt(product.updatedAt);
      setVariants(variantList);
      setPrimaryVariant(primary);
      setSku(primary?.sku ?? "");
      setBarcode(primary?.barcode ?? "");

      const parsed = parseAttrs(product.attributes);
      if (!parsed.baseUomId && defaultUom) parsed.baseUomId = defaultUom.id;
      setAttrs(parsed);

      if (balRes.ok) {
        const balJson = await balRes.json();
        const rows = (balJson.data as { qtyOnHand?: string }[]) ?? [];
        const sum = rows.reduce((acc, r) => acc + Number(r.qtyOnHand ?? 0), 0);
        setStockQty(Number.isFinite(sum) ? String(sum) : "0");
      }

      const list = lists.find((l) => l.isDefault) ?? lists[0];
      if (list && primary) {
        const itemsRes = await adminApi(`/api/v1/price-lists/${list.id}/items`);
        if (itemsRes.ok) {
          const items = ((await itemsRes.json()).data as PriceItem[]) ?? [];
          const forVariant = items.filter((i) => i.productVariantId === primary.id);
          const pick = (type: string) =>
            forVariant.find((i) => i.priceType === type && i.uomId === (parsed.baseUomId || defaultUom?.id))
              ?.amount ?? "";
          setAttrs((prev) => ({
            ...prev,
            purchase: prev.purchase || pick("purchase"),
            retail: prev.retail || pick("retail"),
            wholesale: prev.wholesale || pick("wholesale"),
          }));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [isCreate, loadMasters, productId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function ensurePriceItems(variantId: string, uomId: string, listId: string) {
    const entries: { priceType: string; amount: string }[] = [
      { priceType: "purchase", amount: attrs.purchase },
      { priceType: "retail", amount: attrs.retail },
      { priceType: "wholesale", amount: attrs.wholesale },
    ];
    for (const entry of entries) {
      if (!entry.amount.trim()) continue;
      await adminApi(`/api/v1/price-lists/${listId}/items`, {
        method: "POST",
        body: JSON.stringify({
          productVariantId: variantId,
          uomId,
          priceType: entry.priceType,
          amount: entry.amount.trim(),
        }),
      });
    }
  }

  async function save() {
    if (!name.trim() || !categoryId) return;
    setSaving(true);
    setError(null);
    try {
      const attributes = buildAttributes(attrs, isActive);
      if (isCreate) {
        const res = await adminApi("/api/v1/products", {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            categoryId,
            isActive,
            attributes,
            ...(sku.trim() ? { sku: sku.trim() } : {}),
            ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            `${t("catalog.createFailed")} (${res.status}${json.error ? `: ${json.error}` : ""})`,
          );
        }
        const createdId = (json.data as { id: string }).id;
        const vRes = await adminApi(`/api/v1/products/${createdId}/variants`);
        if (vRes.ok && defaultPriceList && attrs.baseUomId) {
          const vs = ((await vRes.json()).data as Variant[]) ?? [];
          const primary = vs.find((v) => v.isPrimary) ?? vs[0];
          if (primary) {
            await ensurePriceItems(primary.id, attrs.baseUomId, defaultPriceList.id);
          }
        }
        router.push(`/catalog/products/${createdId}`);
        return;
      }

      const res = await adminApi(`/api/v1/products/${productId}`, {
        method: "PATCH",
        headers: { "if-match": String(version) },
        body: JSON.stringify({
          name: name.trim(),
          categoryId,
          isActive,
          attributes,
          version,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          `${t("admin.saveFailed")} (${res.status}${json.error ? `: ${json.error}` : ""})`,
        );
      }

      if (primaryVariant) {
        await adminApi(`/api/v1/variants/${primaryVariant.id}`, {
          method: "PATCH",
          headers: { "if-match": String(primaryVariant.version) },
          body: JSON.stringify({
            sku: sku.trim() || null,
            barcode: barcode.trim() || null,
            version: primaryVariant.version,
          }),
        });
      } else if (sku.trim() || barcode.trim()) {
        await adminApi(`/api/v1/products/${productId}/variants`, {
          method: "POST",
          body: JSON.stringify({
            ...(sku.trim() ? { sku: sku.trim() } : {}),
            ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
          }),
        });
      }

      if (defaultPriceList && attrs.baseUomId) {
        const vRes = await adminApi(`/api/v1/products/${productId}/variants`);
        if (vRes.ok) {
          const vs = ((await vRes.json()).data as Variant[]) ?? [];
          const primary = vs.find((v) => v.isPrimary) ?? vs[0];
          if (primary) {
            await ensurePriceItems(primary.id, attrs.baseUomId, defaultPriceList.id);
          }
        }
      }

      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function addConversion() {
    setAttrs((prev) => ({
      ...prev,
      conversions: [
        ...prev.conversions,
        {
          key: `c-${Date.now()}`,
          uomId: "",
          factor: "1",
          barcode: "",
          purchase: "",
          retail: "",
          wholesale: "",
        },
      ],
    }));
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "general", label: t("catalog.tabGeneral") },
    { id: "inventory", label: t("catalog.tabInventory") },
    { id: "sales", label: t("catalog.tabSales") },
  ];

  return (
    <section className="relative w-full pb-24">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isCreate ? t("catalog.createTitle") : name || t("admin.productsTitle")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isCreate ? t("catalog.editorCreateHint") : t("catalog.editorEditHint")}
          </p>
        </div>
        <Button type="button" variant="outline" asChild>
          <Link href="/catalog/products">{t("catalog.backToList")}</Link>
        </Button>
      </div>

      {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]">
        {/* Left rail */}
        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t("catalog.imagesTitle")}</h2>
              <span className="text-xs text-muted-foreground">{t("catalog.imagesLimit")}</span>
            </div>
            <Button type="button" variant="outline" size="sm" disabled className="mb-3 w-full">
              {t("catalog.uploadImage")}
            </Button>
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 text-center">
              <ImageIcon className="h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="text-xs text-muted-foreground">{t("catalog.noImages")}</p>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-4">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-[var(--primary)]"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium">{t("catalog.activateProduct")}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {t("catalog.activateHint")}
              </span>
            </span>
          </label>

          {!isCreate ? (
            <div className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">{t("catalog.createdAt")}</span>
                <span>{formatDt(createdAt, localeTag)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">{t("catalog.updatedAt")}</span>
                <span>{formatDt(updatedAt, localeTag)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">{t("admin.orgVersion")}</span>
                <span>v{version}</span>
              </div>
            </div>
          ) : null}
        </aside>

        {/* Main */}
        <div className="min-w-0 space-y-4">
          <div className="flex gap-1 border-b border-border">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  tab === item.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === "general" ? (
            <div className="grid gap-6 xl:grid-cols-2">
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="pe-name">
                    {t("catalog.productName")} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="pe-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="pe-sku">SKU</Label>
                      <div className="relative">
                        <Input
                          id="pe-sku"
                          value={sku}
                          onChange={(e) => setSku(e.target.value)}
                          className="pr-9"
                        />
                        <ScanBarcode
                          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                          aria-hidden
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pe-barcode">{t("catalog.colBarcode")}</Label>
                      <div className="relative">
                        <Input
                          id="pe-barcode"
                          value={barcode}
                          onChange={(e) => setBarcode(e.target.value)}
                          className="pr-9"
                        />
                        <ScanBarcode
                          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                          aria-hidden
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setSku(suggestSku(name))}
                    >
                      {t("catalog.genSku")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setBarcode(suggestBarcode())}
                    >
                      {t("catalog.genBarcode")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setSku(suggestSku(name));
                        setBarcode(suggestBarcode());
                      }}
                    >
                      {t("catalog.genBoth")}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label>
                        {t("catalog.colCategory")} <span className="text-destructive">*</span>
                      </Label>
                      <Link
                        href="/catalog/categories"
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        {t("catalog.manage")}
                      </Link>
                    </div>
                    <Select value={categoryId} onValueChange={setCategoryId}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("catalog.colCategory")} />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label>
                        {t("catalog.baseUom")} <span className="text-destructive">*</span>
                      </Label>
                      <Link
                        href="/catalog/uom"
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        {t("catalog.manage")}
                      </Link>
                    </div>
                    <Select
                      value={attrs.baseUomId}
                      onValueChange={(v) => setAttrs((p) => ({ ...p, baseUomId: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("catalog.baseUom")} />
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
                </div>

                <div className="space-y-3 rounded-lg border border-border p-4">
                  <h3 className="text-sm font-semibold">{t("catalog.sellingPrices")}</h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {(
                      [
                        ["purchase", "purchase", t("catalog.pricePurchase")],
                        ["retail", "retail", t("catalog.priceRetail")],
                        ["wholesale", "wholesale", t("catalog.priceWholesale")],
                      ] as const
                    ).map(([key, , label]) => (
                      <div key={key} className="space-y-1.5">
                        <Label htmlFor={`pe-${key}`}>{label}</Label>
                        <Input
                          id={`pe-${key}`}
                          inputMode="decimal"
                          value={attrs[key]}
                          onChange={(e) => setAttrs((p) => ({ ...p, [key]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{t("catalog.priceListHint")}</p>
                </div>
              </div>

              <div className="space-y-5">
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <h3 className="text-sm font-semibold">{t("catalog.stockCostTitle")}</h3>
                  <p className="mt-2 text-sm">
                    {`${t("catalog.stockRemaining")} ${stockQty} ${baseUom?.name ?? "—"} — ${t("catalog.costPrice")} ${attrs.costPrice || "0"}`}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">{t("catalog.stockCostHint")}</p>
                  <div className="mt-3 space-y-1.5">
                    <Label htmlFor="pe-cost">{t("catalog.costPrice")}</Label>
                    <Input
                      id="pe-cost"
                      inputMode="decimal"
                      value={attrs.costPrice}
                      onChange={(e) => setAttrs((p) => ({ ...p, costPrice: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="pe-brand">{t("catalog.brand")}</Label>
                    <Input
                      id="pe-brand"
                      value={attrs.brand}
                      onChange={(e) => setAttrs((p) => ({ ...p, brand: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pe-origin">{t("catalog.origin")}</Label>
                    <Input
                      id="pe-origin"
                      value={attrs.origin}
                      onChange={(e) => setAttrs((p) => ({ ...p, origin: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pe-desc">{t("catalog.description")}</Label>
                  <textarea
                    id="pe-desc"
                    value={attrs.description}
                    onChange={(e) => setAttrs((p) => ({ ...p, description: e.target.value }))}
                    rows={4}
                    className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="space-y-3 rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{t("catalog.extraUoms")}</h3>
                    <Button type="button" size="sm" variant="outline" onClick={addConversion}>
                      {t("catalog.addUom")}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("catalog.extraUomsHint")}</p>
                  {attrs.conversions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("catalog.noExtraUoms")}</p>
                  ) : (
                    attrs.conversions.map((row, index) => (
                      <div
                        key={row.key}
                        className="space-y-3 border-t border-border pt-3 first:border-t-0 first:pt-0"
                      >
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="space-y-1.5 sm:col-span-1">
                            <Label>{t("catalog.conversionUom")}</Label>
                            <Select
                              value={row.uomId}
                              onValueChange={(v) =>
                                setAttrs((p) => {
                                  const next = [...p.conversions];
                                  next[index] = { ...next[index], uomId: v };
                                  return { ...p, conversions: next };
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={t("catalog.conversionUom")} />
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
                            <Label>{t("catalog.factor")}</Label>
                            <Input
                              inputMode="decimal"
                              value={row.factor}
                              onChange={(e) =>
                                setAttrs((p) => {
                                  const next = [...p.conversions];
                                  next[index] = { ...next[index], factor: e.target.value };
                                  return { ...p, conversions: next };
                                })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>{t("catalog.colBarcode")}</Label>
                            <Input
                              value={row.barcode}
                              onChange={(e) =>
                                setAttrs((p) => {
                                  const next = [...p.conversions];
                                  next[index] = { ...next[index], barcode: e.target.value };
                                  return { ...p, conversions: next };
                                })
                              }
                            />
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          {(
                            [
                              ["purchase", t("catalog.pricePurchase")],
                              ["retail", t("catalog.priceRetail")],
                              ["wholesale", t("catalog.priceWholesale")],
                            ] as const
                          ).map(([field, label]) => (
                            <div key={field} className="space-y-1.5">
                              <Label>{label}</Label>
                              <Input
                                inputMode="decimal"
                                value={row[field]}
                                onChange={(e) =>
                                  setAttrs((p) => {
                                    const next = [...p.conversions];
                                    next[index] = { ...next[index], [field]: e.target.value };
                                    return { ...p, conversions: next };
                                  })
                                }
                              />
                            </div>
                          ))}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() =>
                            setAttrs((p) => ({
                              ...p,
                              conversions: p.conversions.filter((_, i) => i !== index),
                            }))
                          }
                        >
                          {t("catalog.removeUom")}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {tab === "inventory" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{t("catalog.inventoryTabHint")}</p>
              {variants.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("catalog.emptyVariants")}</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[36rem] text-left text-sm">
                    <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">SKU</th>
                        <th className="px-3 py-2 font-medium">{t("catalog.colBarcode")}</th>
                        <th className="px-3 py-2 font-medium">{t("catalog.colPrimary")}</th>
                        <th className="px-3 py-2 font-medium">{t("catalog.colActive")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variants.map((v) => (
                        <tr key={v.id} className="border-b border-border/70">
                          <td className="px-3 py-2 font-mono text-xs">{v.sku ?? "—"}</td>
                          <td className="px-3 py-2 font-mono text-xs">{v.barcode ?? "—"}</td>
                          <td className="px-3 py-2">
                            {v.isPrimary ? t("catalog.activeYes") : "—"}
                          </td>
                          <td className="px-3 py-2">
                            {v.isActive ? t("catalog.activeYes") : t("catalog.activeNo")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" asChild>
                  <Link href="/catalog/batches">{t("nav.batches")}</Link>
                </Button>
                <Button type="button" variant="outline" asChild>
                  <Link href="/inventory/balances">{t("nav.inventory")}</Link>
                </Button>
              </div>
            </div>
          ) : null}

          {tab === "sales" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{t("catalog.salesTabHint")}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs text-muted-foreground">{t("catalog.pricePurchase")}</p>
                  <p className="mt-1 text-lg font-semibold">{attrs.purchase || "—"}</p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs text-muted-foreground">{t("catalog.priceRetail")}</p>
                  <p className="mt-1 text-lg font-semibold">{attrs.retail || "—"}</p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs text-muted-foreground">{t("catalog.priceWholesale")}</p>
                  <p className="mt-1 text-lg font-semibold">{attrs.wholesale || "—"}</p>
                </div>
              </div>
              <Button type="button" variant="outline" asChild>
                <Link href="/catalog/pricing">{t("nav.pricing")}</Link>
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[100%] items-center justify-end gap-2 px-4 py-3 lg:px-6">
          <Button type="button" variant="outline" asChild>
            <Link href="/catalog/products">{t("catalog.cancel")}</Link>
          </Button>
          <Button
            type="button"
            disabled={saving || !name.trim() || !categoryId || !attrs.baseUomId}
            onClick={() => void save()}
          >
            {saving
              ? t("admin.loading")
              : isCreate
                ? t("catalog.createProduct")
                : t("catalog.updateProduct")}
          </Button>
        </div>
      </div>
    </section>
  );
}
