// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { createDocumentAction, documentActionAction } from "../../lib/p/actions";
import type { TradingKind } from "../../lib/api-client/client";
import { StatusBanner } from "../h/status-banner";

type Doc = {
  id: string;
  documentNumber?: string;
  status?: string;
  version?: number;
  technicalAckAt?: string | null;
  lines?: { batchId?: string }[];
};

type Option = { id: string; label: string; productVariantId?: string };

export function DocumentsPanel({
  kind,
  title,
  initialDocs,
  batches,
  warehouses,
  partnerId,
}: {
  kind: TradingKind;
  title: string;
  initialDocs: Doc[];
  batches: Option[];
  warehouses: Option[];
  partnerId?: string;
}) {
  const [docs, setDocs] = useState(initialDocs);
  const [batchId, setBatchId] = useState(batches[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [uomId, setUomId] = useState("");
  const [purpose, setPurpose] = useState<"other" | "sale" | "partner_transfer">("other");
  const [sourceLineId, setSourceLineId] = useState("");
  const [linkedIssueId, setLinkedIssueId] = useState("");
  const [inboundMessageId, setInboundMessageId] = useState("");
  const [localBatchId, setLocalBatchId] = useState("");
  const [actualQuantity, setActualQuantity] = useState("");
  const [discrepancyReason, setDiscrepancyReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    startTransition(async () => {
      let body: Record<string, unknown>;
      if (kind === "transfers") {
        if (!partnerId) {
          setError("Chọn đối tác từ handoff H (partnerId) trước khi tạo transfer.");
          return;
        }
        if (!linkedIssueId.trim()) {
          setError("Nhập linkedIssueId (phiếu xuất đã confirm).");
          return;
        }
        body = { linkedIssueId: linkedIssueId.trim(), destinationPartnerId: partnerId };
      } else if (kind === "receivings") {
        if (!inboundMessageId.trim() || !sourceLineId.trim() || !localBatchId.trim() || !uomId.trim()) {
          setError("Receiving cần inboundMessageId, sourceLineId, localBatchId, warehouse, actualQuantity, uomId.");
          return;
        }
        body = {
          inboundMessageId: inboundMessageId.trim(),
          actualLines: [{
            sourceLineId: sourceLineId.trim(),
            localBatchId: localBatchId.trim(),
            warehouseId,
            actualQuantity: actualQuantity || quantity,
            uomId: uomId.trim(),
          }],
          ...(discrepancyReason.trim() ? { discrepancyReason: discrepancyReason.trim() } : {}),
        };
      } else {
        const selected = batches.find((batch) => batch.id === batchId);
        const productVariantId = selected?.productVariantId;
        if (!productVariantId) {
          setError("Batch thiếu productVariantId.");
          return;
        }
        if (!uomId.trim()) {
          setError("Nhập uomId (stock UOM) từ danh mục.");
          return;
        }
        if (kind === "issues") {
          if (!sourceLineId.trim()) {
            setError("Issue cần sourceLineId từ GET /lots/{id}/issue-sources.");
            return;
          }
          body = {
            purpose,
            lines: [{
              warehouseId,
              batchId,
              productVariantId,
              uomId: uomId.trim(),
              quantity,
              sources: [{ sourceLineId: sourceLineId.trim(), quantity }],
            }],
          };
        } else {
          body = {
            lines: [{ warehouseId, batchId, productVariantId, uomId: uomId.trim(), quantity }],
          };
        }
      }
      const result = await createDocumentAction(kind, body);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(`Đã tạo draft ${result.data.id}`);
      window.location.reload();
    });
  }

  function runAction(doc: Doc, action: string, extra: Record<string, unknown> = {}) {
    if (typeof doc.version !== "number") {
      setError("Thiếu version chứng từ.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await documentActionAction(kind, doc.id, action, doc.version!, extra);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDocs((rows) => rows.map((row) =>
        row.id === doc.id ? { ...row, version: (row.version ?? 0) + 1, status: action } : row));
      setMessage(`Đã gửi ${action} cho ${doc.documentNumber ?? doc.id}`);
      window.location.reload();
    });
  }

  return (
    <div className="stack">
      {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}
      {message ? <StatusBanner tone="success">{message}</StatusBanner> : null}
      {partnerId ? (
        <StatusBanner tone="info">
          Handoff partnerId <code>{partnerId}</code> — dùng làm destinationPartnerId, không gửi organizationId.
        </StatusBanner>
      ) : null}

      <form className="panel form-grid" onSubmit={create}>
        <h2>Tạo {title} (Draft)</h2>
        {kind === "transfers" ? (
          <>
            <label>linkedIssueId
              <input value={linkedIssueId} onChange={(e) => setLinkedIssueId(e.target.value)} required
                placeholder="uuid phiếu xuất" />
            </label>
            <p className="muted">destinationPartnerId lấy từ handoff H. Transfer không tạo movement.</p>
          </>
        ) : null}
        {kind === "receivings" ? (
          <>
            <label>inboundMessageId
              <input value={inboundMessageId} onChange={(e) => setInboundMessageId(e.target.value)} required />
            </label>
            <label>sourceLineId
              <input value={sourceLineId} onChange={(e) => setSourceLineId(e.target.value)} required />
            </label>
            <label>localBatchId
              <input value={localBatchId} onChange={(e) => setLocalBatchId(e.target.value)} required />
            </label>
            <label>Kho nhận
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
                {warehouses.map((warehouse) =>
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.label}</option>)}
              </select>
            </label>
            <label>Actual quantity
              <input value={actualQuantity || quantity} onChange={(e) => setActualQuantity(e.target.value)} required />
            </label>
            <label>UOM ID
              <input value={uomId} onChange={(e) => setUomId(e.target.value)} required />
            </label>
            <label>Discrepancy reason (khi lệch)
              <input value={discrepancyReason} onChange={(e) => setDiscrepancyReason(e.target.value)} />
            </label>
            <p className="muted">Technical ACK tách khỏi business confirm. Sent vs actual do server validate.</p>
          </>
        ) : null}
        {kind === "receipts" || kind === "issues" ? (
          <>
            <label>Lô / batch
              <select value={batchId} onChange={(e) => setBatchId(e.target.value)} required>
                {batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.label}</option>)}
              </select>
            </label>
            <label>Kho
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
                {warehouses.map((warehouse) =>
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.label}</option>)}
              </select>
            </label>
            <label>Số lượng
              <input value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
            </label>
            <label>UOM ID (stock)
              <input value={uomId} onChange={(e) => setUomId(e.target.value)} required
                placeholder="uuid đơn vị tồn" />
            </label>
            {kind === "issues" ? (
              <>
                <label>Purpose
                  <select value={purpose} onChange={(e) =>
                    setPurpose(e.target.value as typeof purpose)}>
                    <option value="other">other</option>
                    <option value="sale">sale</option>
                    <option value="partner_transfer">partner_transfer</option>
                  </select>
                </label>
                <label>sourceLineId
                  <input value={sourceLineId} onChange={(e) => setSourceLineId(e.target.value)} required
                    placeholder="từ issue-sources API" />
                </label>
              </>
            ) : null}
          </>
        ) : null}
        <button type="submit" disabled={pending}>
          {pending ? "Đang tạo…" : "Tạo draft"}
        </button>
        <p className="muted">Validation số lượng/UOM/quality đến từ server. Confirm chỉ qua action được bảo vệ.</p>
      </form>

      <section className="panel">
        <h2>Danh sách</h2>
        {!docs.length
          ? <StatusBanner tone="info">Chưa có chứng từ.</StatusBanner>
          : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Số</th>
                  <th>Trạng thái</th>
                  <th>ACK kỹ thuật</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <Link href={`/operations/${kind}?id=${doc.id}`}>
                        {doc.documentNumber ?? doc.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td>{doc.status ?? "—"}</td>
                    <td>{doc.technicalAckAt ? "ACK" : "—"}</td>
                    <td className="actions">
                      {doc.status === "draft" && kind === "issues" ? (
                        <button type="button" disabled={pending}
                          onClick={() => runAction(doc, "submit")}>Submit</button>
                      ) : null}
                      {(doc.status === "draft" || doc.status === "approved") ? (
                        <button type="button" disabled={pending}
                          onClick={() => runAction(doc, "confirm")}>
                          Confirm
                        </button>
                      ) : null}
                      {doc.status === "draft" ? (
                        <button type="button" disabled={pending}
                          onClick={() => runAction(doc, "cancel")}>Cancel</button>
                      ) : null}
                      {doc.lines?.[0]?.batchId
                        ? <Link href={`/data/lots/${doc.lines[0].batchId}`}>Trace</Link>
                        : <Link href="/data/lots">Lots</Link>}
                      {kind === "transfers"
                        ? <Link href="/operations/receivings">→ Receiving</Link>
                        : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>
    </div>
  );
}
