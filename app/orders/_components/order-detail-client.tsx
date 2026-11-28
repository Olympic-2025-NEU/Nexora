// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";

type OrderLot = {
  id: string;
  invoiceItemId: string;
  batchId: string;
  batchLocalCode: string | null;
  quantity: string;
  warehouseId: string;
};

type OrderLine = {
  id: string;
  lineNo: number;
  productId: string;
  productName: string | null;
  productVariantId: string;
  variantSku: string | null;
  quantity: string;
  unitPrice: string;
  lineDiscount: string;
  lineTotal: string;
  uomId: string;
  uomName: string | null;
  lots: OrderLot[];
};

type Order = {
  id: string;
  orderNumber: string;
  status: string;
  version: number;
  currency: string;
  subtotalAmount: string;
  discountAmount: string;
  totalAmount: string;
  paidAmount: string;
  paymentMethod: string;
  soldAt: string;
  sellerMembershipId: string | null;
  sellerDisplayName: string | null;
  customerPartnerId: string | null;
  customerDisplayName: string | null;
  customerCode: string | null;
  linkedIssueId: string | null;
  linkedIssueNumber: string | null;
  linkedSaleId: string | null;
  qrPath: string | null;
  qrUrl: string | null;
  publicTraceToken?: string;
  lines: OrderLine[];
};

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return iso;
  }
}

function formatMoney(amount: string, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "VND",
      maximumFractionDigits: currency === "VND" ? 0 : 2,
    }).format(n);
  } catch {
    return `${amount} ${currency}`;
  }
}

function formatQty(qty: string): string {
  const n = Number(qty);
  if (!Number.isFinite(n)) return qty;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(n);
}

function paymentLabel(method: string, t: (key: string) => string): string {
  if (method === "cash") return t("pos.payCash");
  if (method === "transfer") return t("pos.payTransfer");
  if (method === "card") return t("pos.payCard");
  return method;
}

function statusLabel(status: string, t: (key: string) => string): string {
  if (status === "draft") return t("orders.statusDraft");
  if (status === "paid") return t("orders.statusPaid");
  if (status === "fulfilled") return t("orders.statusFulfilled");
  if (status === "cancelled") return t("orders.statusCancelled");
  return status;
}

export function OrderDetailClient({ id }: { id: string }) {
  const t = useT();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reissuedToken, setReissuedToken] = useState<string | null>(null);
  const [reissuedQrUrl, setReissuedQrUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi(`/api/v1/orders/${id}`);
      if (res.status === 403) throw new Error(t("admin.forbidden"));
      if (!res.ok) throw new Error(`${t("admin.loadFailed")} (${res.status})`);
      setOrder((await res.json()).data as Order);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function cancelDraft() {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi(`/api/v1/orders/${order.id}/cancel`, {
        method: "POST",
        headers: { "if-match": String(order.version) },
        body: "{}",
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errBody?.error ?? t("orders.actionFailed"));
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("orders.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function reissueQr() {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi(`/api/v1/orders/${order.id}/trace/reissue`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: "{}",
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errBody?.error ?? t("orders.actionFailed"));
      }
      const data = (await res.json()).data as Order;
      setReissuedToken(data.publicTraceToken ?? null);
      setReissuedQrUrl(data.qrUrl ?? data.qrPath ?? null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("orders.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  const qrDisplay = reissuedQrUrl || order?.qrUrl || order?.qrPath;
  const qrAbsolute =
    qrDisplay && typeof window !== "undefined" && !qrDisplay.startsWith("http")
      ? `${window.location.origin}${qrDisplay.startsWith("/") ? "" : "/"}${qrDisplay}`
      : qrDisplay;
  const qrImgSrc = qrAbsolute
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrAbsolute)}`
    : null;

  const discountValue = order ? Number(order.discountAmount) : 0;

  return (
    <section className="w-full space-y-6">
      <PageHeader
        title={order?.orderNumber ?? t("orders.detailTitle")}
        description={t("orders.detailHint")}
        actions={
          <Button type="button" variant="outline" asChild>
            <Link href="/orders">{t("orders.backToList")}</Link>
          </Button>
        }
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading || !order ? (
        <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("orders.colStatus")}</p>
              <p className="mt-1 text-sm font-medium">{statusLabel(order.status, t)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("orders.colSoldAt")}</p>
              <p className="mt-1 text-sm">{formatWhen(order.soldAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("pos.payMethod")}</p>
              <p className="mt-1 text-sm">{paymentLabel(order.paymentMethod, t)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("pos.seller")}</p>
              <p className="mt-1 text-sm">{order.sellerDisplayName || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("pos.customer")}</p>
              <p className="mt-1 text-sm">
                {order.customerDisplayName
                  ? `${order.customerDisplayName}${order.customerCode ? ` (${order.customerCode})` : ""}`
                  : t("pos.customerNone")}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("orders.colIssue")}</p>
              <p className="mt-1 text-sm">
                {order.linkedIssueNumber || (order.linkedIssueId ? order.linkedIssueId.slice(0, 8) : "—")}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("orders.colSubtotal")}</p>
              <p className="mt-1 text-sm tabular-nums">
                {formatMoney(order.subtotalAmount, order.currency)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("pos.discount")}</p>
              <p className="mt-1 text-sm tabular-nums">
                {discountValue > 0
                  ? `−${formatMoney(order.discountAmount, order.currency)}`
                  : formatMoney("0", order.currency)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("orders.colTotal")}</p>
              <p className="mt-1 text-base font-semibold tabular-nums">
                {formatMoney(order.totalAmount, order.currency)}
              </p>
            </div>
          </div>

          {order.status === "fulfilled" && qrImgSrc ? (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-5 sm:flex-row sm:items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrImgSrc}
                alt={t("orders.qrAlt")}
                width={180}
                height={180}
                className="rounded border border-border"
              />
              <div className="space-y-2 text-sm">
                <p className="font-medium">{t("orders.qrTitle")}</p>
                <p className="text-muted-foreground">{t("orders.qrHint")}</p>
                {qrAbsolute ? (
                  <p className="break-all font-mono text-xs text-muted-foreground">{qrAbsolute}</p>
                ) : null}
                {reissuedToken ? (
                  <p className="break-all font-mono text-xs">{reissuedToken}</p>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void reissueQr()}
                >
                  {t("orders.reissueQr")}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">{t("orders.colProduct")}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t("orders.colQty")}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t("orders.colPrice")}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t("orders.colLineTotal")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("orders.colBatch")}</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((line) => (
                  <tr key={line.id} className="border-b border-border/70">
                    <td className="px-3 py-2.5 align-top">{line.lineNo}</td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="font-medium text-foreground">
                        {line.productName || t("orders.unknownProduct")}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {[line.variantSku, line.uomName].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top text-right tabular-nums">
                      {formatQty(line.quantity)}
                      {line.uomName ? (
                        <span className="ml-1 text-xs text-muted-foreground">{line.uomName}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 align-top text-right tabular-nums">
                      {formatMoney(line.unitPrice, order.currency)}
                    </td>
                    <td className="px-3 py-2.5 align-top text-right font-medium tabular-nums">
                      {formatMoney(line.lineTotal, order.currency)}
                    </td>
                    <td className="px-3 py-2.5 align-top text-sm text-muted-foreground">
                      {line.lots.length
                        ? line.lots
                            .map(
                              (lot) =>
                                `${lot.batchLocalCode || lot.batchId.slice(0, 8)} × ${formatQty(lot.quantity)}`,
                            )
                            .join(", ")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted/20">
                  <td colSpan={4} className="px-3 py-2.5 text-right text-muted-foreground">
                    {t("orders.colSubtotal")}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatMoney(order.subtotalAmount, order.currency)}
                  </td>
                  <td />
                </tr>
                {discountValue > 0 ? (
                  <tr className="bg-muted/20">
                    <td colSpan={4} className="px-3 py-2.5 text-right text-muted-foreground">
                      {t("pos.discount")}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-destructive">
                      −{formatMoney(order.discountAmount, order.currency)}
                    </td>
                    <td />
                  </tr>
                ) : null}
                <tr className="bg-muted/30">
                  <td colSpan={4} className="px-3 py-2.5 text-right font-medium">
                    {t("orders.colTotal")}
                  </td>
                  <td className="px-3 py-2.5 text-right text-base font-semibold tabular-nums">
                    {formatMoney(order.totalAmount, order.currency)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {order.status === "draft" || order.status === "paid" ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => void cancelDraft()}>
                {t("orders.cancelDraft")}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
