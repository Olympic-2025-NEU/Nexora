// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
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
import { SupplierFormModal } from "@/app/trading/suppliers/_components/supplier-form-modal";
import type { LocalSupplierRow } from "@/app/trading/suppliers/_components/types";

type SourceKind = "local" | "nexora";

type LocalLine = {
  key: string;
  productVariantId: string;
  batchId: string;
  warehouseId: string;
  uomId: string;
  quantity: string;
  productLabel?: string;
};

type NexoraLot = {
  sourceLineId: string;
  quantity: string;
  unit: "EA" | "KG" | "L";
  product: { productId: string };
  senderBatch: { batchId: string };
};

type NexoraMessage = {
  messageId: string;
  issuerInstanceId: string;
  sourceDocument: { id: string };
  lots: NexoraLot[];
  receivingStatus?: string;
  partnerDisplayName?: string | null;
  partnerCode?: string | null;
};

type NexoraEntry = {
  sourceLineId: string;
  actualQuantity: string;
  localBatchId: string;
  warehouseId: string;
  unit: NexoraLot["unit"];
};

type BatchOption = { id: string; localCode: string; productVariantId: string };
type VariantOption = { id: string; label: string; productId: string };
type UomOption = { uomId: string; isStockKeeping: boolean; code?: string };

type ReceiptDoc = {
  id: string;
  documentNumber: string;
  status: string;
  version: number;
  note: string | null;
  localSupplierId: string | null;
  localSupplier: { id: string; code: string; displayName: string } | null;
  lines: {
    id: string;
    warehouseId: string;
    productVariantId: string;
    batchId: string;
    uomId: string;
    quantity: string | null;
  }[];
};

type ReceivingDoc = {
  id: string;
  documentNumber: string;
  status: string;
  version: number;
  inboundMessageId: string;
  sourceIssuerInstanceId: string;
  sourceTransferId: string;
  sentQuantity: string;
  actualQuantity: string | null;
  discrepancyQuantity: string | null;
  discrepancyReason: string | null;
  lines: {
    id: string;
    sourceLineId: string;
    batchId: string;
    warehouseId: string;
    productId: string;
    sentQuantity: string;
    actualQuantity: string;
  }[];
};

function newLineKey() {
  return crypto.randomUUID();
}

export function InboundFormClient({
  id,
  initialKind,
}: {
  id?: string;
  initialKind?: SourceKind;
}) {
  const t = useT();
  const router = useRouter();
  const creating = !id;

  const [sourceKind, setSourceKind] = useState<SourceKind>(initialKind ?? "local");
  const [kindLocked, setKindLocked] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  // Shared catalogs
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [suppliers, setSuppliers] = useState<LocalSupplierRow[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);

  // Local lines
  const [localLines, setLocalLines] = useState<LocalLine[]>([
    { key: newLineKey(), productVariantId: "", batchId: "", warehouseId: "", uomId: "", quantity: "" },
  ]);
  const [uomsByVariant, setUomsByVariant] = useState<Record<string, UomOption[]>>({});
  const [receipt, setReceipt] = useState<ReceiptDoc | null>(null);

  // Nexora
  const [messages, setMessages] = useState<NexoraMessage[]>([]);
  const [messageId, setMessageId] = useState("");
  const [nexoraBatches, setNexoraBatches] = useState<Record<string, BatchOption[]>>({});
  const [nexoraEntries, setNexoraEntries] = useState<NexoraEntry[]>([]);
  const [reason, setReason] = useState("");
  const [receiving, setReceiving] = useState<ReceivingDoc | null>(null);

  const message = useMemo(
    () => messages.find((m) => m.messageId === messageId) ?? null,
    [messages, messageId],
  );

  const loadCatalogs = useCallback(async () => {
    const [wh, products, lots, supplierRes] = await Promise.all([
      adminApi("/api/v1/warehouses?limit=100"),
      adminApi("/api/v1/products?limit=50"),
      adminApi("/api/v1/batches?limit=100"),
      adminApi("/api/v1/local-suppliers?status=active"),
    ]);
    if (wh.ok) setWarehouses(((await wh.json()).data ?? []) as { id: string; name: string }[]);
    if (lots.ok) {
      setBatches(
        (((await lots.json()).data ?? []) as BatchOption[]).map((b) => ({
          id: b.id,
          localCode: b.localCode,
          productVariantId: b.productVariantId,
        })),
      );
    }
    if (supplierRes.ok) {
      setSuppliers(((await supplierRes.json()).data as LocalSupplierRow[]) ?? []);
    }
    if (products.ok) {
      const productsData = ((await products.json()).data ?? []) as { id: string; name: string }[];
      const pages = await Promise.all(
        productsData.map(async (product) => {
          const response = await adminApi(`/api/v1/products/${product.id}/variants`);
          if (!response.ok) return [];
          return ((await response.json()).data as { id: string; sku: string | null }[]).map(
            (variant) => ({
              id: variant.id,
              productId: product.id,
              label: `${product.name} · ${variant.sku ?? variant.id.slice(0, 8)}`,
            }),
          );
        }),
      );
      setVariants(pages.flat());
    }
  }, []);

  const loadNexoraOptions = useCallback(async () => {
    const res = await adminApi("/api/v1/receivings?options=1");
    if (!res.ok) {
      // Local path must still work when federation options are unavailable.
      console.warn("inbound nexora options failed", res.status);
      setMessages([]);
      return;
    }
    const data = (await res.json()).data as {
      messages: NexoraMessage[];
      warehouses: { id: string; name: string }[];
    };
    setMessages(data.messages ?? []);
    if (data.warehouses?.length) setWarehouses(data.warehouses);
  }, []);

  const loadExisting = useCallback(async () => {
    if (!id) return;
    setKindLocked(true);
    const preferNexora = initialKind === "nexora";
    const order: SourceKind[] = preferNexora ? ["nexora", "local"] : ["local", "nexora"];
    let loaded = false;
    for (const kind of order) {
      if (kind === "local") {
        const res = await adminApi(`/api/v1/receipts/${id}`);
        if (!res.ok) continue;
        const doc = (await res.json()).data as ReceiptDoc;
        setSourceKind("local");
        setReceipt(doc);
        setNote(doc.note ?? "");
        setSupplierId(doc.localSupplierId ?? "");
        setLocalLines(
          doc.lines.length
            ? doc.lines.map((line) => ({
                key: line.id,
                productVariantId: line.productVariantId,
                batchId: line.batchId,
                warehouseId: line.warehouseId,
                uomId: line.uomId,
                quantity: line.quantity ?? "",
              }))
            : [
                {
                  key: newLineKey(),
                  productVariantId: "",
                  batchId: "",
                  warehouseId: "",
                  uomId: "",
                  quantity: "",
                },
              ],
        );
        loaded = true;
        break;
      }
      const res = await adminApi(`/api/v1/receivings/${id}`);
      if (!res.ok) continue;
      const doc = (await res.json()).data as ReceivingDoc;
      setSourceKind("nexora");
      setReceiving(doc);
      setMessageId(doc.inboundMessageId);
      setReason(doc.discrepancyReason ?? "");
      setNexoraEntries(
        doc.lines.map((line) => ({
          sourceLineId: line.sourceLineId,
          actualQuantity: line.actualQuantity,
          localBatchId: line.batchId,
          warehouseId: line.warehouseId,
          unit: "EA",
        })),
      );
      loaded = true;
      break;
    }
    if (!loaded) throw new Error(t("inbound.loadFailed"));
  }, [id, initialKind, t]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      void (async () => {
        try {
          setError(null);
          await loadCatalogs();
          await loadNexoraOptions();
          if (id) await loadExisting();
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : t("inbound.loadFailed"));
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [id, loadCatalogs, loadExisting, loadNexoraOptions, t]);

  useEffect(() => {
    if (!messageId) return;
    let active = true;
    void adminApi(`/api/v1/receivings?batchesFor=${encodeURIComponent(messageId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(t("inbound.batchesFailed"));
        const rows = (await response.json()).data as {
          sourceLineId: string;
          batches: BatchOption[];
        }[];
        if (active) {
          setNexoraBatches(Object.fromEntries(rows.map((row) => [row.sourceLineId, row.batches])));
        }
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [messageId, t]);

  async function ensureUoms(variantId: string) {
    if (!variantId || uomsByVariant[variantId]) return;
    const res = await adminApi(`/api/v1/variants/${variantId}/uoms`);
    if (!res.ok) return;
    const rows = ((await res.json()).data ?? []) as UomOption[];
    setUomsByVariant((prev) => ({ ...prev, [variantId]: rows }));
  }

  function updateLocalLine(key: string, patch: Partial<LocalLine>) {
    setLocalLines((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function selectMessage(value: string) {
    setMessageId(value);
    setReason("");
    setNexoraBatches({});
    const msg = messages.find((row) => row.messageId === value);
    setNexoraEntries(
      (msg?.lots ?? []).map((lot) => ({
        sourceLineId: lot.sourceLineId,
        actualQuantity: lot.quantity,
        localBatchId: "",
        warehouseId: warehouses[0]?.id ?? "",
        unit: lot.unit,
      })),
    );
  }

  function changeNexora(sourceLineId: string, field: keyof NexoraEntry, value: string) {
    setNexoraEntries((current) =>
      current.map((row) => (row.sourceLineId === sourceLineId ? { ...row, [field]: value } : row)),
    );
  }

  const draftStatus =
    sourceKind === "local" ? receipt?.status === "draft" || creating : receiving?.status === "draft" || creating;
  const readOnly = !draftStatus;

  async function saveLocal(asConfirm: boolean) {
    setBusy(true);
    setError(null);
    try {
      const lines = localLines.map((line) => ({
        warehouseId: line.warehouseId,
        productVariantId: line.productVariantId,
        batchId: line.batchId,
        uomId: line.uomId,
        quantity: line.quantity,
      }));
      if (lines.some((l) => !l.warehouseId || !l.productVariantId || !l.batchId || !l.uomId || !l.quantity)) {
        throw new Error(t("inbound.linesIncomplete"));
      }
      const payload = {
        lines,
        note: note.trim() || undefined,
        localSupplierId: supplierId || null,
      };
      let docId = receipt?.id;
      let version = receipt?.version;
      if (creating || !docId) {
        const res = await adminApi("/api/v1/receipts", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? t("inbound.saveFailed"));
        }
        const created = (await res.json()).data as ReceiptDoc;
        docId = created.id;
        version = created.version;
        setReceipt(created);
        setKindLocked(true);
        if (!asConfirm) {
          router.replace(`/trading/inbound/${created.id}?kind=local`);
          return;
        }
      } else {
        const res = await adminApi(`/api/v1/receipts/${docId}`, {
          method: "PATCH",
          headers: { "If-Match": String(version) },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? t("inbound.saveFailed"));
        }
        const updated = (await res.json()).data as ReceiptDoc;
        setReceipt(updated);
        version = updated.version;
      }
      if (asConfirm && docId && version != null) {
        const res = await adminApi(`/api/v1/receipts/${docId}/confirm`, {
          method: "POST",
          headers: {
            "If-Match": String(version),
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: "{}",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? t("inbound.confirmFailed"));
        }
        setReceipt((await res.json()).data as ReceiptDoc);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("inbound.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function saveNexora(action: "create" | "update" | "confirm" | "cancel") {
    setBusy(true);
    setError(null);
    try {
      if (action === "create") {
        const res = await adminApi("/api/v1/receivings", {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            inboundMessageId: messageId,
            actualLines: nexoraEntries,
            ...(reason.trim() ? { discrepancyReason: reason.trim() } : {}),
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? t("inbound.saveFailed"));
        }
        const created = (await res.json()).data as ReceivingDoc;
        setKindLocked(true);
        router.replace(`/trading/inbound/${created.id}?kind=nexora`);
        return;
      }
      if (!receiving) return;
      if (action === "update") {
        const res = await adminApi(`/api/v1/receivings/${receiving.id}`, {
          method: "PATCH",
          headers: { "if-match": String(receiving.version) },
          body: JSON.stringify({
            actualLines: nexoraEntries.map(
              ({ sourceLineId, actualQuantity, localBatchId, warehouseId }) => ({
                sourceLineId,
                actualQuantity,
                localBatchId,
                warehouseId,
              }),
            ),
            discrepancyReason: reason,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? t("inbound.saveFailed"));
        }
        setReceiving((await res.json()).data as ReceivingDoc);
        return;
      }
      const res = await adminApi(`/api/v1/receivings/${receiving.id}/${action}`, {
        method: "POST",
        headers: {
          "if-match": String(receiving.version),
          ...(action === "confirm" ? { "idempotency-key": crypto.randomUUID() } : {}),
        },
        body: "{}",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? t("inbound.confirmFailed"));
      }
      setReceiving((await res.json()).data as ReceivingDoc);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("inbound.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function cancelLocal() {
    if (!receipt) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi(`/api/v1/receipts/${receipt.id}/cancel`, {
        method: "POST",
        headers: { "If-Match": String(receipt.version) },
        body: "{}",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? t("inbound.cancelFailed"));
      }
      setReceipt((await res.json()).data as ReceiptDoc);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("inbound.cancelFailed"));
    } finally {
      setBusy(false);
    }
  }

  const title = creating
    ? t("inbound.createTitle")
    : sourceKind === "local"
      ? (receipt?.documentNumber ?? t("inbound.detailTitle"))
      : (receiving?.documentNumber ?? t("inbound.detailTitle"));

  return (
    <section className="w-full space-y-6">
      <PageHeader
        title={title}
        description={t("inbound.formHint")}
        actions={
          <Button type="button" variant="outline" asChild>
            <Link href="/trading/inbound">{t("inbound.backToList")}</Link>
          </Button>
        }
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("inbound.sourceKind")}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={sourceKind === "local" ? "default" : "outline"}
                disabled={kindLocked || readOnly}
                onClick={() => setSourceKind("local")}
              >
                {t("inbound.sourceLocal")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={sourceKind === "nexora" ? "default" : "outline"}
                disabled={kindLocked || readOnly}
                onClick={() => setSourceKind("nexora")}
              >
                {t("inbound.sourceNexora")}
              </Button>
            </div>
          </div>

          {sourceKind === "local" ? (
            <div className="space-y-1.5">
              <Label>{t("inbound.localSupplier")}</Label>
              <div className="flex gap-2">
                <Select
                  value={supplierId || "__none__"}
                  onValueChange={(v) => setSupplierId(v === "__none__" ? "" : v)}
                  disabled={readOnly}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={t("inbound.localSupplierNone")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("inbound.localSupplierNone")}</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.displayName} ({s.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!readOnly ? (
                  <Button type="button" variant="outline" onClick={() => setSupplierModalOpen(true)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>{t("inbound.inboundNotice")}</Label>
              <Select
                value={messageId || "__none__"}
                onValueChange={(v) => {
                  if (v === "__none__") {
                    setMessageId("");
                    setNexoraEntries([]);
                    return;
                  }
                  selectMessage(v);
                }}
                disabled={readOnly || !creating}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("inbound.pickNotice")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("inbound.pickNotice")}</SelectItem>
                  {messages.map((item) => (
                    <SelectItem key={item.messageId} value={item.messageId}>
                      {(item.partnerDisplayName
                        ? `${item.partnerDisplayName}`
                        : item.issuerInstanceId) +
                        ` · ${item.sourceDocument.id.slice(0, 8)} · ${item.receivingStatus ?? "pending_receipt"}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {sourceKind === "local" ? (
          <div className="space-y-1.5">
            <Label htmlFor="inbound-note">{t("inbound.note")}</Label>
            <Input
              id="inbound-note"
              value={note}
              disabled={readOnly}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        ) : null}
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("inbound.linesTitle")}</h2>
          {sourceKind === "local" && !readOnly ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setLocalLines((rows) => [
                  ...rows,
                  {
                    key: newLineKey(),
                    productVariantId: "",
                    batchId: "",
                    warehouseId: warehouses[0]?.id ?? "",
                    uomId: "",
                    quantity: "",
                  },
                ])
              }
            >
              <Plus className="h-4 w-4" />
              {t("inbound.addLine")}
            </Button>
          ) : null}
        </div>

        {sourceKind === "local" ? (
          <div className="space-y-3">
            {localLines.map((line) => {
              const variantBatches = batches.filter(
                (b) => !line.productVariantId || b.productVariantId === line.productVariantId,
              );
              const uoms = uomsByVariant[line.productVariantId] ?? [];
              return (
                <div
                  key={line.key}
                  className="grid gap-3 rounded-md border border-border/70 p-3 md:grid-cols-6"
                >
                  <div className="md:col-span-2 space-y-1">
                    <Label>{t("inbound.colProduct")}</Label>
                    <Select
                      value={line.productVariantId || "__none__"}
                      disabled={readOnly}
                      onValueChange={(v) => {
                        const next = v === "__none__" ? "" : v;
                        updateLocalLine(line.key, {
                          productVariantId: next,
                          batchId: "",
                          uomId: "",
                        });
                        if (next) void ensureUoms(next);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("inbound.pickProduct")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("inbound.pickProduct")}</SelectItem>
                        {variants.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>{t("inbound.colBatch")}</Label>
                    <Select
                      value={line.batchId || "__none__"}
                      disabled={readOnly}
                      onValueChange={(v) =>
                        updateLocalLine(line.key, { batchId: v === "__none__" ? "" : v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("inbound.pickBatch")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("inbound.pickBatch")}</SelectItem>
                        {variantBatches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.localCode}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>{t("inbound.colWarehouse")}</Label>
                    <Select
                      value={line.warehouseId || "__none__"}
                      disabled={readOnly}
                      onValueChange={(v) =>
                        updateLocalLine(line.key, { warehouseId: v === "__none__" ? "" : v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("inbound.pickWarehouse")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("inbound.pickWarehouse")}</SelectItem>
                        {warehouses.map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>{t("inbound.colQty")}</Label>
                    <Input
                      value={line.quantity}
                      disabled={readOnly}
                      onChange={(e) => updateLocalLine(line.key, { quantity: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("inbound.colUom")}</Label>
                    <div className="flex gap-1">
                      <Select
                        value={line.uomId || "__none__"}
                        disabled={readOnly}
                        onValueChange={(v) =>
                          updateLocalLine(line.key, { uomId: v === "__none__" ? "" : v })
                        }
                        onOpenChange={(open) => {
                          if (open && line.productVariantId) void ensureUoms(line.productVariantId);
                        }}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="UOM" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">UOM</SelectItem>
                          {uoms.map((u) => (
                            <SelectItem key={u.uomId} value={u.uomId}>
                              {u.code ?? u.uomId.slice(0, 8)}
                              {u.isStockKeeping ? " *" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!readOnly && localLines.length > 1 ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() =>
                            setLocalLines((rows) => rows.filter((r) => r.key !== line.key))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            {(message?.lots ??
              receiving?.lines.map((line) => ({
                sourceLineId: line.sourceLineId,
                quantity: line.sentQuantity,
                unit: "EA" as const,
                product: { productId: line.productId },
                senderBatch: { batchId: "—" },
              })) ??
              []).map((lot) => {
              const entry = nexoraEntries.find((row) => row.sourceLineId === lot.sourceLineId);
              if (!entry) return null;
              return (
                <div
                  key={lot.sourceLineId}
                  className="grid gap-3 rounded-md border border-border/70 p-3 md:grid-cols-4"
                >
                  <div className="md:col-span-4 text-sm text-muted-foreground">
                    {t("inbound.sentQty")}: {lot.quantity} {lot.unit} · {t("inbound.colProduct")}:{" "}
                    {lot.product.productId.slice(0, 8)}
                  </div>
                  <div className="space-y-1">
                    <Label>{t("inbound.actualQty")}</Label>
                    <Input
                      type="number"
                      min="0"
                      step={lot.unit === "EA" ? "1" : "0.001"}
                      disabled={readOnly}
                      value={entry.actualQuantity}
                      onChange={(e) =>
                        changeNexora(lot.sourceLineId, "actualQuantity", e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("inbound.colBatch")}</Label>
                    <Select
                      value={entry.localBatchId || "__none__"}
                      disabled={readOnly}
                      onValueChange={(v) =>
                        changeNexora(
                          lot.sourceLineId,
                          "localBatchId",
                          v === "__none__" ? "" : v,
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("inbound.pickBatch")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("inbound.pickBatch")}</SelectItem>
                        {(nexoraBatches[lot.sourceLineId] ?? []).map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.localCode}
                          </SelectItem>
                        ))}
                        {entry.localBatchId &&
                        !(nexoraBatches[lot.sourceLineId] ?? []).some(
                          (b) => b.id === entry.localBatchId,
                        ) ? (
                          <SelectItem value={entry.localBatchId}>
                            {entry.localBatchId.slice(0, 8)}
                          </SelectItem>
                        ) : null}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>{t("inbound.colWarehouse")}</Label>
                    <Select
                      value={entry.warehouseId || "__none__"}
                      disabled={readOnly}
                      onValueChange={(v) =>
                        changeNexora(
                          lot.sourceLineId,
                          "warehouseId",
                          v === "__none__" ? "" : v,
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("inbound.pickWarehouse")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("inbound.pickWarehouse")}</SelectItem>
                        {warehouses.map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
            {sourceKind === "nexora" && (message || receiving) ? (
              <div className="space-y-1.5">
                <Label>{t("inbound.discrepancyReason")}</Label>
                <Input
                  value={reason}
                  disabled={readOnly}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>

      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          {sourceKind === "local" ? (
            <>
              <Button type="button" disabled={busy} onClick={() => void saveLocal(false)}>
                {t("inbound.saveDraft")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void saveLocal(true)}
              >
                {t("inbound.confirm")}
              </Button>
              {receipt?.status === "draft" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void cancelLocal()}
                >
                  {t("inbound.cancelDraft")}
                </Button>
              ) : null}
            </>
          ) : (
            <>
              {creating ? (
                <Button
                  type="button"
                  disabled={busy || !messageId}
                  onClick={() => void saveNexora("create")}
                >
                  {t("inbound.saveDraft")}
                </Button>
              ) : (
                <>
                  <Button type="button" disabled={busy} onClick={() => void saveNexora("update")}>
                    {t("inbound.saveDraft")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void saveNexora("confirm")}
                  >
                    {t("inbound.confirm")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void saveNexora("cancel")}
                  >
                    {t("inbound.cancelDraft")}
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      ) : null}

      <SupplierFormModal
        open={supplierModalOpen}
        onClose={() => setSupplierModalOpen(false)}
        onSaved={(row) => {
          void loadCatalogs();
          if (row?.id) setSupplierId(row.id);
        }}
      />
    </section>
  );
}
