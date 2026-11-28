// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Minus, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Combobox } from "@/app/components/ui/combobox";
import { DateTimePicker } from "@/app/components/ui/date-time-picker";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { PageHeader } from "@/app/components/ui/page-header";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";
import { fetchMe, getCachedMe } from "@/app/lib/session";
import { ProductThumb } from "@/app/products/_components/product-thumb";
import {
  clearPosOrderDraft,
  readPosOrderDraft,
  writePosOrderDraft,
  type PosCartLine,
  type PosPayMethod,
} from "../_lib/draft-store";

/** Roles allowed to operate POS / confirm sales (ADR 0018). */
const SELLER_ROLES = new Set(["administrator", "sales_clerk"]);

function memberHasSellerRole(m: { role: string; roles?: string[] }): boolean {
  const roles = m.roles?.length ? m.roles : [m.role];
  return roles.some((r) => SELLER_ROLES.has(r));
}

type ProductRow = {
  id: string;
  name: string;
  isActive: boolean;
  primaryVariantId?: string | null;
  primarySku?: string | null;
  primaryBarcode?: string | null;
  baseUomId?: string | null;
  baseUomName?: string | null;
  priceRetail?: string | null;
  primaryImageAttachmentId?: string | null;
};

type MemberRow = {
  id: string;
  keycloakSub?: string;
  displayName: string;
  role: string;
  roles?: string[];
  status: string;
};

type PartnerRow = {
  id: string;
  code: string;
  displayName: string;
  status: string;
};

type WarehouseRow = {
  id: string;
  code: string;
  name: string;
  status: string;
};

type CartLine = PosCartLine;
type PayMethod = PosPayMethod;

function formatMoney(value: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(value);
  } catch {
    return String(value);
  }
}

function parsePrice(value: string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parseMoneyInput(raw: string): number {
  const cleaned = raw.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function nowLocalInputValue(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function PosClient() {
  const t = useT();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);
  const skipPriceBlurCommit = useRef(false);

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<ProductRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState("");

  const [sellers, setSellers] = useState<MemberRow[]>([]);
  const [customers, setCustomers] = useState<PartnerRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  const [cart, setCart] = useState<CartLine[]>(() => readPosOrderDraft()?.cart ?? []);
  const [sellerId, setSellerId] = useState(() => readPosOrderDraft()?.sellerId ?? "");
  const [customerId, setCustomerId] = useState(() => readPosOrderDraft()?.customerId ?? "");
  const [warehouseId, setWarehouseId] = useState(() => readPosOrderDraft()?.warehouseId ?? "");
  const [soldAt, setSoldAt] = useState(
    () => readPosOrderDraft()?.soldAt ?? nowLocalInputValue(),
  );
  const [discountRaw, setDiscountRaw] = useState(
    () => readPosOrderDraft()?.discountRaw ?? "0",
  );
  const [paidRaw, setPaidRaw] = useState(() => readPosOrderDraft()?.paidRaw ?? "");
  const [payMethod, setPayMethod] = useState<PayMethod>(
    () => readPosOrderDraft()?.payMethod ?? "cash",
  );

  // Keep draft in RAM while the cart has lines (survives soft route changes).
  useEffect(() => {
    if (cart.length === 0) {
      clearPosOrderDraft();
      return;
    }
    writePosOrderDraft({
      cart,
      sellerId,
      customerId,
      warehouseId,
      soldAt,
      discountRaw,
      paidRaw,
      payMethod,
    });
  }, [cart, sellerId, customerId, warehouseId, soldAt, discountRaw, paidRaw, payMethod]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      void (async () => {
        const me = getCachedMe() ?? (await fetchMe());
        if (cancelled) return;

        // Sellers: active members with sales roles (admin list). Fall back to current user.
        try {
          const res = await adminApi("/api/v1/members");
          if (res.ok) {
            const json = await res.json();
            const rows = ((json.data as MemberRow[]) ?? []).filter(
              (m) => m.status === "active" && memberHasSellerRole(m),
            );
            if (!cancelled) {
              setSellers(rows);
              setSellerId((prev) => {
                if (prev && rows.some((m) => m.id === prev)) return prev;
                if (rows.length === 0) return prev;
                const match =
                  rows.find(
                    (m) =>
                      me &&
                      (m.keycloakSub === me.userId || m.displayName === me.displayName),
                  ) ?? rows[0];
                return match.id;
              });
            }
          } else if (me) {
            const fallback: MemberRow = {
              id: me.userId,
              displayName: me.displayName || me.userId,
              role: me.roles[0] ?? "sales_clerk",
              roles: me.roles,
              status: "active",
            };
            if (!cancelled) {
              setSellers([fallback]);
              setSellerId((prev) => prev || fallback.id);
            }
          }
        } catch {
          if (!cancelled && me) {
            const fallback: MemberRow = {
              id: me.userId,
              displayName: me.displayName || me.userId,
              role: me.roles[0] ?? "sales_clerk",
              roles: me.roles,
              status: "active",
            };
            setSellers([fallback]);
            setSellerId((prev) => prev || fallback.id);
          }
        }

        // Customers: org partners (nullable selection).
        try {
          const res = await adminApi("/api/v1/partners");
          if (res.ok && !cancelled) {
            const json = await res.json();
            const rows = ((json.data as PartnerRow[]) ?? []).filter(
              (p) => p.status === "active",
            );
            setCustomers(rows);
          }
        } catch {
          /* optional — leave empty */
        }

        try {
          const res = await adminApi("/api/v1/warehouses");
          if (res.ok && !cancelled) {
            const json = await res.json();
            const rows = ((json.data as WarehouseRow[]) ?? []).filter((w) => w.status === "active");
            setWarehouses(rows);
            setWarehouseId((prev) => {
              if (prev && rows.some((w) => w.id === prev)) return prev;
              return rows[0]?.id ?? prev;
            });
          }
        } catch {
          /* optional */
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const sellerOptions = useMemo(
    () =>
      sellers.map((m) => ({
        value: m.id,
        label: m.displayName,
        keywords: m.role,
      })),
    [sellers],
  );

  const customerOptions = useMemo(
    () =>
      customers.map((p) => ({
        value: p.id,
        label: p.displayName,
        keywords: p.code,
      })),
    [customers],
  );

  const warehouseOptions = useMemo(
    () =>
      warehouses.map((w) => ({
        value: w.id,
        label: `${w.code} — ${w.name}`,
        keywords: w.code,
      })),
    [warehouses],
  );

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSuggestions([]);
      setSearching(false);
      setSearchError(null);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const qs = new URLSearchParams({ limit: "8", q });
          const res = await adminApi(`/api/v1/products?${qs}`);
          if (cancelled) return;
          if (res.status === 403) throw new Error(t("admin.forbidden"));
          if (!res.ok) throw new Error(`${t("admin.loadFailed")} (${res.status})`);
          const json = await res.json();
          setSuggestions(((json.data as ProductRow[]) ?? []).filter((p) => p.isActive));
          setSearchError(null);
        } catch (err) {
          if (!cancelled) {
            setSuggestions([]);
            setSearchError(err instanceof Error ? err.message : t("admin.loadFailed"));
          }
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, t]);

  const totals = useMemo(() => {
    const subtotal = cart.reduce((acc, line) => acc + line.qty * line.unitPrice, 0);
    const discount = Math.min(parseMoneyInput(discountRaw), subtotal);
    const due = Math.max(0, subtotal - discount);
    const paid = parseMoneyInput(paidRaw);
    const change = Math.max(0, paid - due);
    return { subtotal, discount, due, paid, change };
  }, [cart, discountRaw, paidRaw]);

  const addProduct = useCallback((product: ProductRow) => {
    setCheckoutMessage(null);
    if (!product.primaryVariantId || !product.baseUomId) {
      setCheckoutMessage(t("pos.variantRequired"));
      return;
    }
    const unitPrice = parsePrice(product.priceRetail);
    const variantId = product.primaryVariantId;
    const uomId = product.baseUomId;
    setCart((prev) => {
      const existing = prev.find((line) => line.productVariantId === variantId);
      if (existing) {
        return prev.map((line) =>
          line.productVariantId === variantId ? { ...line, qty: line.qty + 1 } : line,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          productVariantId: variantId,
          uomId,
          name: product.name,
          sku: product.primarySku || product.primaryBarcode || "—",
          uomName: product.baseUomName || "—",
          unitPrice,
          qty: 1,
          attachmentId: product.primaryImageAttachmentId,
        },
      ];
    });
    setQuery("");
    setSuggestions([]);
    searchRef.current?.focus();
  }, [t]);

  function setQty(productId: string, qty: number) {
    setCheckoutMessage(null);
    setCart((prev) => {
      if (qty <= 0) return prev.filter((line) => line.productId !== productId);
      return prev.map((line) => (line.productId === productId ? { ...line, qty } : line));
    });
  }

  function removeLine(productId: string) {
    setCheckoutMessage(null);
    setCart((prev) => prev.filter((line) => line.productId !== productId));
    if (editingPriceId === productId) {
      setEditingPriceId(null);
      setPriceDraft("");
    }
  }

  function beginEditPrice(line: CartLine) {
    setEditingPriceId(line.productId);
    setPriceDraft(String(Math.round(line.unitPrice)));
  }

  function cancelEditPrice() {
    skipPriceBlurCommit.current = true;
    setEditingPriceId(null);
    setPriceDraft("");
  }

  function commitEditPrice(productId: string) {
    if (skipPriceBlurCommit.current) {
      skipPriceBlurCommit.current = false;
      return;
    }
    // Swallow the blur that follows Enter so we do not commit twice.
    skipPriceBlurCommit.current = true;
    const next = parseMoneyInput(priceDraft);
    setCheckoutMessage(null);
    setCart((prev) =>
      prev.map((line) => (line.productId === productId ? { ...line, unitPrice: next } : line)),
    );
    setEditingPriceId(null);
    setPriceDraft("");
  }

  useEffect(() => {
    if (!editingPriceId) return;
    const el = priceInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editingPriceId]);

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const top = suggestions[0];
    if (top) addProduct(top);
  }

  async function checkout() {
    if (cart.length === 0 || checkoutBusy) return;
    if (!warehouseId) {
      setCheckoutMessage(t("pos.warehouseRequired"));
      return;
    }
    if (!sellerId) {
      setCheckoutMessage(t("pos.sellerRequired"));
      return;
    }
    if (totals.paid < totals.due && payMethod === "cash") {
      setCheckoutMessage(t("pos.paidInsufficient"));
      return;
    }

    setCheckoutBusy(true);
    setCheckoutMessage(null);
    try {
      const body = {
        warehouseId,
        sellerMembershipId: sellerId,
        ...(customerId ? { customerPartnerId: customerId } : {}),
        soldAt: new Date(soldAt).toISOString(),
        paymentMethod: payMethod,
        paidAmount: String(payMethod === "cash" ? totals.paid : totals.due),
        discountAmount: String(totals.discount),
        lines: cart.map((line) => ({
          productVariantId: line.productVariantId,
          uomId: line.uomId,
          quantity: String(line.qty),
          unitPrice: String(line.unitPrice),
          priceType: "retail" as const,
        })),
      };

      const res = await adminApi("/api/v1/orders/checkout", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errBody?.error ?? t("pos.checkoutFailed"));
      }
      const created = (await res.json()).data as { id: string };

      clearPosOrderDraft();
      setCart([]);
      setPaidRaw("");
      setDiscountRaw("0");
      router.push(`/orders/${created.id}`);
    } catch (err) {
      setCheckoutMessage(err instanceof Error ? err.message : t("pos.checkoutFailed"));
    } finally {
      setCheckoutBusy(false);
    }
  }

  const showSuggestions = query.trim().length > 0;

  return (
    <section className="flex w-full flex-col gap-4 lg:h-[calc(100vh-7rem)] lg:min-h-[36rem]">
      <PageHeader
        title={t("pos.title")}
        description={t("pos.hint")}
        actions={
          <Button type="button" variant="outline" asChild>
            <Link href="/orders">{t("pos.backToOrders")}</Link>
          </Button>
        }
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.85fr)]">
        {/* Box 1: search + suggestions + cart */}
        <div className="relative flex min-h-0 flex-col gap-4 overflow-visible rounded-lg border border-border bg-card p-4">
          <div className="relative z-30">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder={t("pos.searchPlaceholder")}
                aria-label={t("pos.searchPlaceholder")}
                aria-autocomplete="list"
                aria-expanded={showSuggestions}
                className="relative z-10 h-11 bg-card pl-9"
                autoFocus
              />
            </div>

            {showSuggestions ? (
              <div className="absolute left-0 right-0 top-full z-40 mt-1.5 max-h-72 overflow-y-auto rounded-md border border-border bg-card text-card-foreground shadow-overlay">
                {searching ? (
                  <p className="px-3 py-2.5 text-sm text-muted-foreground">{t("admin.loading")}</p>
                ) : searchError ? (
                  <p className="px-3 py-2.5 text-sm text-destructive">{searchError}</p>
                ) : suggestions.length === 0 ? (
                  <p className="px-3 py-2.5 text-sm text-muted-foreground">
                    {t("pos.emptyProducts")}
                  </p>
                ) : (
                  <ul role="listbox" className="bg-card">
                    {suggestions.map((product, index) => (
                      <li key={product.id} className="bg-card">
                        <button
                          type="button"
                          role="option"
                          aria-selected={index === 0}
                          onClick={() => addProduct(product)}
                          className={`flex w-full items-center gap-3 bg-card px-3 py-2.5 text-left transition hover:bg-muted ${
                            index === 0 ? "bg-muted" : ""
                          }`}
                        >
                          <ProductThumb
                            attachmentId={product.primaryImageAttachmentId}
                            alt={product.name}
                            className="h-10 w-10"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {product.name}
                            </span>
                            <span className="block font-mono text-[11px] text-muted-foreground">
                              {product.primarySku || product.primaryBarcode || "—"}
                              {product.baseUomName ? ` · ${product.baseUomName}` : ""}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">
                            {formatMoney(parsePrice(product.priceRetail))}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="border-t border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground">
                  {t("pos.enterHint")}
                </p>
              </div>
            ) : null}
          </div>

          <div className="relative z-0 flex min-h-0 flex-1 flex-col">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{t("pos.cart")}</h2>
              <span className="text-xs text-muted-foreground">
                {cart.length === 0
                  ? t("pos.emptyCart")
                  : `${cart.reduce((n, l) => n + l.qty, 0)} ${t("pos.items")}`}
              </span>
            </div>

            {cart.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border bg-muted/20 px-4 py-10">
                <p className="text-sm text-muted-foreground">{t("pos.cartHint")}</p>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead className="sticky top-0 border-b border-border bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t("pos.colProduct")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("pos.colPrice")}</th>
                      <th className="px-3 py-2 text-center font-medium">{t("pos.colQty")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("pos.colLineTotal")}</th>
                      <th className="w-10 px-2 py-2">
                        <span className="sr-only">{t("admin.actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((line) => (
                      <tr key={line.productId} className="border-b border-border/70">
                        <td className="px-3 py-2.5 align-middle">
                          <div className="flex items-center gap-2">
                            <ProductThumb
                              attachmentId={line.attachmentId}
                              alt={line.name}
                              className="h-9 w-9"
                            />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{line.name}</p>
                              <p className="font-mono text-[11px] text-muted-foreground">
                                {line.sku} · {line.uomName}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right align-middle">
                          {editingPriceId === line.productId ? (
                            <Input
                              ref={priceInputRef}
                              value={priceDraft}
                              onChange={(e) => setPriceDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitEditPrice(line.productId);
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelEditPrice();
                                }
                              }}
                              onBlur={() => commitEditPrice(line.productId)}
                              inputMode="decimal"
                              aria-label={t("pos.editPrice")}
                              className="ml-auto h-8 w-[6.5rem] px-2 text-right tabular-nums"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => beginEditPrice(line)}
                              className="group ml-auto inline-flex items-center justify-end gap-1 rounded-sm text-right tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              aria-label={t("pos.editPrice")}
                              title={t("pos.editPrice")}
                            >
                              <span className="underline-offset-4 group-hover:underline group-hover:decoration-muted-foreground/80">
                                {formatMoney(line.unitPrice)}
                              </span>
                              <Pencil
                                className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                                aria-hidden
                              />
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <div className="flex items-center justify-center gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 p-0"
                              onClick={() => setQty(line.productId, line.qty - 1)}
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </Button>
                            <span className="w-7 text-center tabular-nums">{line.qty}</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 p-0"
                              onClick={() => setQty(line.productId, line.qty + 1)}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium tabular-nums align-middle">
                          {formatMoney(line.qty * line.unitPrice)}
                        </td>
                        <td className="px-2 py-2.5 align-middle">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => removeLine(line.productId)}
                            aria-label={t("pos.removeLine")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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

        {/* Right: sale info */}
        <aside className="flex min-h-0 flex-col rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">{t("pos.orderInfo")}</h2>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pos-seller">{t("pos.seller")}</Label>
                <Combobox
                  id="pos-seller"
                  value={sellerId}
                  onChange={setSellerId}
                  options={sellerOptions}
                  placeholder={t("pos.sellerPlaceholder")}
                  searchPlaceholder={t("pos.sellerSearch")}
                  disabled={sellerOptions.length === 0}
                  aria-label={t("pos.seller")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pos-sold-at">{t("pos.soldAt")}</Label>
                <DateTimePicker
                  id="pos-sold-at"
                  mode="datetime"
                  value={soldAt}
                  onChange={setSoldAt}
                  placeholder={t("pos.soldAtPlaceholder")}
                  hourLabel={t("pos.hour")}
                  minuteLabel={t("pos.minute")}
                  aria-label={t("pos.soldAt")}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pos-customer">{t("pos.customer")}</Label>
              <Combobox
                id="pos-customer"
                value={customerId}
                onChange={setCustomerId}
                options={customerOptions}
                placeholder={t("pos.customerPlaceholder")}
                searchPlaceholder={t("pos.customerSearch")}
                emptyLabel={t("pos.customerNone")}
                aria-label={t("pos.customer")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pos-warehouse">{t("pos.warehouse")}</Label>
              <Combobox
                id="pos-warehouse"
                value={warehouseId}
                onChange={setWarehouseId}
                options={warehouseOptions}
                placeholder={t("pos.warehousePlaceholder")}
                searchPlaceholder={t("pos.warehouseSearch")}
                aria-label={t("pos.warehouse")}
              />
              <p className="text-[11px] text-muted-foreground">{t("pos.warehouseHint")}</p>
            </div>

            <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t("pos.subtotal")}</span>
                <span className="tabular-nums">{formatMoney(totals.subtotal)}</span>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pos-discount">{t("pos.discount")}</Label>
                <Input
                  id="pos-discount"
                  inputMode="decimal"
                  value={discountRaw}
                  onChange={(e) => setDiscountRaw(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-between border-t border-border/60 pt-2">
                <span className="text-sm font-medium">{t("pos.due")}</span>
                <span className="text-lg font-semibold tabular-nums">
                  {formatMoney(totals.due)}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pos-paid">{t("pos.paid")}</Label>
              <Input
                id="pos-paid"
                inputMode="decimal"
                value={paidRaw}
                onChange={(e) => setPaidRaw(e.target.value)}
                placeholder={formatMoney(totals.due)}
              />
              {totals.paid > 0 && totals.change > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("pos.change")}:{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {formatMoney(totals.change)}
                  </span>
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pos-pay-method">{t("pos.payMethod")}</Label>
              <select
                id="pos-pay-method"
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value as PayMethod)}
                className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="cash">{t("pos.payCash")}</option>
                <option value="transfer">{t("pos.payTransfer")}</option>
                <option value="card">{t("pos.payCard")}</option>
              </select>
            </div>
          </div>

          <div className="space-y-2 border-t border-border p-4">
            {checkoutMessage ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">{checkoutMessage}</p>
            ) : null}
            <Button
              type="button"
              className="h-11 w-full text-base"
              disabled={cart.length === 0 || checkoutBusy}
              onClick={() => void checkout()}
            >
              {checkoutBusy ? t("admin.loading") : t("pos.checkout")}
            </Button>
          </div>
        </aside>
      </div>
    </section>
  );
}
