// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ListFilters, type FilterField } from "@/app/components/ui/list-filters";
import { PageHeader } from "@/app/components/ui/page-header";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";
import { filtersToSearchParams } from "@/app/lib/filter-params";

type Item = {
  id: string;
  documentType: string;
  documentNumber: string;
  status: string;
  version: number;
  createdBySub: string;
  createdAt: string;
  confirmedAt: string | null;
  linkedIssueId?: string;
  destinationPartnerId?: string;
  deliveryState?: string;
  sourceIssuerInstanceId?: string;
  sourceTransferId?: string;
};
type Detail = Item & {
  note: string | null;
  lines: {
    id: string;
    lineNo: number;
    warehouseId: string;
    batchId: string;
    quantity: string | null;
    actualQuantity: string | null;
    countedQuantity: string | null;
  }[];
  movements: {
    id: string;
    lineId: string;
    kind: string;
    delta: string;
    balanceAfter: string;
    createdAt: string;
  }[];
  approval: { id: string; state: string; processInstanceId: string | null } | null;
  delivery?: { state: string; technicalAckAt: string | null; businessReceiptAt: string | null };
};

const STATUS_VALUES = [
  "draft",
  "pending_approval",
  "approved",
  "confirmed",
  "cancelled",
  "rejected",
] as const;

const EMPTY_FILTERS: Record<string, string> = {
  type: "",
  status: "",
  batchId: "",
  partnerId: "",
  from: "",
  to: "",
};

export function HistoryClient({ id }: { id?: string }) {
  const t = useT();
  const [items, setItems] = useState<Item[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>(EMPTY_FILTERS);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!id);

  const filterFields = useMemo<FilterField[]>(
    () => [
      {
        type: "select",
        key: "type",
        label: t("trading.type"),
        placeholder: t("trading.allTypes"),
        options: [
          { value: "goods_receipt", label: t("trading.typeGoodsReceipt") },
          { value: "goods_issue", label: t("trading.typeGoodsIssue") },
          { value: "partner_transfer", label: t("trading.typePartnerTransfer") },
          { value: "receiving_confirmation", label: t("trading.typeReceivingConfirmation") },
          { value: "stocktake", label: t("trading.typeStocktake") },
          { value: "sale_record", label: t("trading.typeSaleRecord") },
        ],
      },
      {
        type: "select",
        key: "status",
        label: t("trading.status"),
        placeholder: t("trading.allStatuses"),
        options: STATUS_VALUES.map((value) => ({ value, label: value })),
      },
      {
        type: "text",
        key: "batchId",
        label: t("trading.batchId"),
        placeholder: t("trading.batchId"),
      },
      {
        type: "text",
        key: "partnerId",
        label: t("trading.partnerId"),
        placeholder: t("trading.partnerId"),
      },
      {
        type: "dateRange",
        fromKey: "from",
        toKey: "to",
        label: t("filters.dateRange"),
        placeholder: t("filters.pickDateRange"),
      },
    ],
    [t],
  );

  const load = useCallback(async () => {
    if (id) {
      setLoading(true);
      setError("");
      try {
        const response = await adminApi(`/api/v1/documents/${id}`);
        if (!response.ok) throw new Error(t("trading.historyDetailFailed"));
        setDetail((await response.json()).data as Detail);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("trading.historyDetailFailed"));
      } finally {
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = filtersToSearchParams(filters);
      const response = await adminApi(`/api/v1/documents?${params.toString()}`);
      if (!response.ok) throw new Error(t("trading.historyLoadFailed"));
      setItems(((await response.json()).data ?? []) as Item[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("trading.historyLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [id, filters, t]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (id) {
    if (loading && !detail) {
      return (
        <section className="w-full space-y-4">
          <p className="text-sm text-muted-foreground">{error || t("admin.loading")}</p>
        </section>
      );
    }
    if (!detail) {
      return (
        <section className="w-full space-y-4">
          <p className="text-sm text-destructive">{error || t("trading.historyDetailFailed")}</p>
          <Link href="/trading/history" className="text-sm text-primary hover:underline">
            ← {t("trading.backToHistory")}
          </Link>
        </section>
      );
    }
    return (
      <section className="w-full space-y-6">
        <PageHeader
          title={`${detail.documentNumber} · ${detail.documentType}`}
          description={`${t("trading.status")}: ${detail.status} · ${t("trading.colCreatedBy")}: ${detail.createdBySub} · ${detail.createdAt}`}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {detail.approval ? (
          <p className="text-sm text-muted-foreground">
            Approval: {detail.approval.state}
            {detail.approval.processInstanceId
              ? ` · Flowable: ${detail.approval.processInstanceId}`
              : ""}
          </p>
        ) : null}
        {detail.delivery ? (
          <p className="text-sm text-muted-foreground">Delivery: {detail.delivery.state}</p>
        ) : null}
        {detail.linkedIssueId ? (
          <p className="text-sm text-muted-foreground">Linked issue: {detail.linkedIssueId}</p>
        ) : null}
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">#</th>
                <th className="px-3 py-2.5 font-medium">Warehouse</th>
                <th className="px-3 py-2.5 font-medium">Batch</th>
                <th className="px-3 py-2.5 font-medium">Qty</th>
                <th className="px-3 py-2.5 font-medium">Actual</th>
                <th className="px-3 py-2.5 font-medium">Counted</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((line) => (
                <tr key={line.id} className="border-b border-border/70">
                  <td className="px-3 py-2.5">{line.lineNo}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{line.warehouseId}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{line.batchId}</td>
                  <td className="px-3 py-2.5">{line.quantity ?? "—"}</td>
                  <td className="px-3 py-2.5">{line.actualQuantity ?? "—"}</td>
                  <td className="px-3 py-2.5">{line.countedQuantity ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Movements</h2>
          {detail.movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">Kind</th>
                    <th className="px-3 py-2.5 font-medium">Delta</th>
                    <th className="px-3 py-2.5 font-medium">Balance</th>
                    <th className="px-3 py-2.5 font-medium">{t("trading.colTime")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.movements.map((movement) => (
                    <tr key={movement.id} className="border-b border-border/70">
                      <td className="px-3 py-2.5">{movement.kind}</td>
                      <td className="px-3 py-2.5">{movement.delta}</td>
                      <td className="px-3 py-2.5">{movement.balanceAfter}</td>
                      <td className="px-3 py-2.5">{movement.createdAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <Link href="/trading/history" className="text-sm text-primary hover:underline">
          ← {t("trading.backToHistory")}
        </Link>
      </section>
    );
  }

  return (
    <section className="w-full space-y-6">
      <PageHeader title={t("trading.historyTitle")} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <ListFilters
        fields={filterFields}
        values={filters}
        onApply={setFilters}
        applyLabel={t("filters.apply")}
        clearLabel={t("filters.clear")}
      />
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10">
          <p className="text-sm text-muted-foreground">{t("trading.emptyHistory")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">{t("trading.colNumber")}</th>
                <th className="px-3 py-2.5 font-medium">{t("trading.colType")}</th>
                <th className="px-3 py-2.5 font-medium">{t("trading.colStatus")}</th>
                <th className="px-3 py-2.5 font-medium">{t("trading.colCreatedBy")}</th>
                <th className="px-3 py-2.5 font-medium">{t("trading.colTime")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border/70 hover:bg-muted/20">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/trading/history/${item.id}`}
                      className="font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {item.documentNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">{item.documentType}</td>
                  <td className="px-3 py-2.5">{item.status}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{item.createdBySub}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{item.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
