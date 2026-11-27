// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { createDocumentAction, documentActionAction, editDocumentAction,
  loadIssueSourcesAction, loadReceivingBatchesAction } from "../../lib/p/actions";
import type { TradingKind } from "../../lib/api-client/client";
import { StatusBanner } from "../h/status-banner";

type Doc = {
  id: string;
  documentNumber?: string;
  status?: string;
  version?: number;
  technicalAckAt?: string | null;
  sentQuantity?: string;
  actualQuantity?: string | null;
  discrepancyQuantity?: string | null;
  discrepancyReason?: string | null;
  events?: { reply?: { status?: string; attempts?: number } | null };
  lines?: { warehouseId?: string; batchId?: string; productVariantId?: string; uomId?: string;
    quantity?: string; sentQuantity?: string; actualQuantity?: string }[];
};

type Option = { id: string; label: string; productVariantId?: string;
  qualityStatus?: string; expiresOn?: string };
type Balance = { batchId: string; warehouseId: string; quantity: string; stockUomId: string };
type IssueSource = { sourceLineId: string; availableQuantity: string; uomId: string };
type ReceivingMessage = { messageId: string; issuerInstanceId: string; sentQuantity: string;
  receivingStatus: string; sourceDocument: { id: string };
  lots: { sourceLineId: string; quantity: string; unit: "EA" | "KG" | "L" }[] };
type ReceivingLine = { sourceLineId: string; localBatchId: string; actualQuantity: string;
  unit: "EA" | "KG" | "L"; sentQuantity: string; batchOptions: Option[] };

export function DocumentsPanel({
  kind,
  title,
  initialDocs,
  batches,
  warehouses,
  balances,
  uoms,
  partnerId,
  selectedDoc,
  receivingMessages,
}: {
  kind: TradingKind;
  title: string;
  initialDocs: Doc[];
  batches: Option[];
  warehouses: Option[];
  balances: Balance[];
  uoms: Option[];
  partnerId?: string;
  selectedDoc?: Doc;
  receivingMessages: ReceivingMessage[];
}) {
  const router = useRouter();
  const docs = initialDocs;
  const [batchId, setBatchId] = useState(batches[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [uomId, setUomId] = useState("");
  const [purpose, setPurpose] = useState<"other" | "sale" | "partner_transfer">("other");
  const [sourceLineId, setSourceLineId] = useState("");
  const [issueSources, setIssueSources] = useState<IssueSource[]>([]);
  const [linkedIssueId, setLinkedIssueId] = useState("");
  const [inboundMessageId, setInboundMessageId] = useState("");
  const [receivingLines, setReceivingLines] = useState<ReceivingLine[]>([]);
  const [discrepancyReason, setDiscrepancyReason] = useState("");
  const [editQuantity, setEditQuantity] = useState(String(selectedDoc?.lines?.[0]?.quantity ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const selectedBatch = batches.find((batch) => batch.id === batchId);
  const selectedBalance = balances.find((balance) =>
    balance.batchId === batchId && balance.warehouseId === warehouseId);
  const effectiveUomId = uomId || selectedBalance?.stockUomId || "";

  function loadSources() {
    setError(null);
    setSourceLineId("");
    startTransition(async () => {
      const result = await loadIssueSourcesAction(batchId, warehouseId);
      if (!result.ok) { setError(result.message); return; }
      setIssueSources(result.data);
    });
  }

  function chooseReceiving(messageId: string) {
    setInboundMessageId(messageId);
    setError(null);
    const message = receivingMessages.find((item) => item.messageId === messageId);
    setReceivingLines((message?.lots ?? []).map((lot) => ({
      sourceLineId: lot.sourceLineId, localBatchId: "", actualQuantity: lot.quantity,
      sentQuantity: lot.quantity, unit: lot.unit, batchOptions: [],
    })));
    if (!messageId) return;
    startTransition(async () => {
      const result = await loadReceivingBatchesAction(messageId);
      if (!result.ok) { setError(result.message); return; }
      setReceivingLines((current) => current.map((line) => ({ ...line,
        batchOptions: result.data.find((row) => row.sourceLineId === line.sourceLineId)?.batches ?? [],
      })));
    });
  }

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
        if (!inboundMessageId || !receivingLines.length || !warehouseId ||
            receivingLines.some((line) => !line.localBatchId || !line.batchOptions.length ||
              !Number.isFinite(Number(line.actualQuantity)) || Number(line.actualQuantity) < 0)) {
          setError("Chọn thông báo nhận hàng, lô nhận và số lượng thực tế hợp lệ cho mọi dòng.");
          return;
        }
        body = {
          inboundMessageId,
          actualLines: receivingLines.map((line) => ({
            sourceLineId: line.sourceLineId, localBatchId: line.localBatchId,
            warehouseId, actualQuantity: line.actualQuantity, unit: line.unit,
          })),
          ...(discrepancyReason.trim() ? { discrepancyReason: discrepancyReason.trim() } : {}),
        };
      } else {
        const selected = batches.find((batch) => batch.id === batchId);
        const productVariantId = selected?.productVariantId;
        if (!productVariantId) {
          setError("Batch thiếu productVariantId.");
          return;
        }
        if (!effectiveUomId) {
          setError("Chọn đơn vị tồn từ danh mục.");
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
              uomId: effectiveUomId,
              quantity,
              sources: [{ sourceLineId: sourceLineId.trim(), quantity }],
            }],
          };
        } else {
          body = {
            lines: [{ warehouseId, batchId, productVariantId, uomId: effectiveUomId, quantity }],
          };
        }
      }
      let result;
      try { result = await createDocumentAction(kind, body); }
      catch {
        setError("Mất kết nối khi tạo. Dữ liệu form được giữ; kiểm tra danh sách trước khi gửi lại.");
        return;
      }
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(`Đã tạo draft ${result.data.id}`);
      router.push(`/operations/${kind}?id=${encodeURIComponent(result.data.id)}`);
      router.refresh();
    });
  }

  function runAction(doc: Doc, action: string, extra: Record<string, unknown> = {}) {
    if (typeof doc.version !== "number") {
      setError("Thiếu version chứng từ.");
      return;
    }
    setError(null);
    startTransition(async () => {
      let result;
      try { result = await documentActionAction(kind, doc.id, action, doc.version!, extra); }
      catch {
        setError("Mất kết nối. Kiểm tra trạng thái phiếu trước khi lặp lại thao tác.");
        return;
      }
      if (!result.ok) {
        setError(result.message);
        return;
      }
      window.location.reload();
    });
  }

  function saveReceipt(event: FormEvent) {
    event.preventDefault();
    const line = selectedDoc?.lines?.[0];
    if (!selectedDoc || selectedDoc.status !== "draft" || typeof selectedDoc.version !== "number" ||
        !line?.warehouseId || !line.batchId || !line.productVariantId || !line.uomId ||
        !Number.isFinite(Number(editQuantity)) || Number(editQuantity) <= 0) {
      setError("Draft thiếu dòng hợp lệ hoặc số lượng phải lớn hơn 0.");
      return;
    }
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = await editDocumentAction("receipts", selectedDoc.id, selectedDoc.version!, {
          lines: [{ warehouseId: line.warehouseId, batchId: line.batchId,
            productVariantId: line.productVariantId, uomId: line.uomId, quantity: editQuantity }],
        });
      } catch {
        setError("Mất kết nối khi lưu. Giữ số lượng đã nhập và kiểm tra phiên bản trước khi thử lại.");
        return;
      }
      if (!result.ok) { setError(result.message); return; }
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
            <label>Thông báo chuyển hàng đã xác minh
              <select value={inboundMessageId} onChange={(e) => chooseReceiving(e.target.value)} required>
                <option value="">Chọn thông báo</option>
                {receivingMessages.filter((message) => message.receivingStatus === "pending_receipt")
                  .map((message) => <option key={message.messageId} value={message.messageId}>
                    {message.issuerInstanceId} · {message.sourceDocument.id.slice(0, 8)} · gửi {message.sentQuantity}
                  </option>)}
              </select>
            </label>
            {receivingLines.map((line, index) => <fieldset key={line.sourceLineId} className="panel stack">
              <legend>Dòng {index + 1} · nguồn {line.sourceLineId.slice(0, 8)}</legend>
              <p>Đã gửi {line.sentQuantity} {line.unit}</p>
              <label>Lô nhận phù hợp
                <select value={line.localBatchId} required
                  onChange={(event) => setReceivingLines((current) => current.map((item) =>
                    item.sourceLineId === line.sourceLineId
                      ? { ...item, localBatchId: event.target.value } : item))}>
                  <option value="">Chọn lô</option>
                  {line.batchOptions.map((batch) =>
                    <option key={batch.id} value={batch.id}>{batch.label}</option>)}
                </select>
              </label>
              <label>Thực nhận ({line.unit})
                <input value={line.actualQuantity} required inputMode="decimal"
                  onChange={(event) => setReceivingLines((current) => current.map((item) =>
                    item.sourceLineId === line.sourceLineId
                      ? { ...item, actualQuantity: event.target.value } : item))} />
              </label>
            </fieldset>)}
            <label>Kho nhận
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
                {warehouses.map((warehouse) =>
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.label}</option>)}
              </select>
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
              <select value={batchId} onChange={(e) => { setBatchId(e.target.value); setIssueSources([]); setSourceLineId(""); }} required>
                {batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.label}</option>)}
              </select>
            </label>
            <label>Kho
              <select value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setIssueSources([]); setSourceLineId(""); }} required>
                {warehouses.map((warehouse) =>
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.label}</option>)}
              </select>
            </label>
            <p className="muted">Variant: {selectedBatch?.productVariantId || "—"} · quality: {selectedBatch?.qualityStatus || "—"}
              {" · "}hết hạn: {selectedBatch?.expiresOn || "—"} · tồn kho đã tải: {selectedBalance?.quantity ?? "0"}</p>
            <label>Số lượng
              <input value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
            </label>
            <label>Đơn vị tồn
              <select value={effectiveUomId} onChange={(e) => setUomId(e.target.value)} required>
                <option value="">Chọn đơn vị</option>
                {uoms.map((uom) => <option key={uom.id} value={uom.id}>{uom.label}</option>)}
              </select>
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
                <label>Nguồn xuất
                  <select value={sourceLineId} onChange={(e) => setSourceLineId(e.target.value)} required>
                    <option value="">Chọn nguồn</option>
                    {issueSources.map((source) => <option key={source.sourceLineId} value={source.sourceLineId}>
                      {source.sourceLineId.slice(0, 8)} · còn {source.availableQuantity}
                    </option>)}
                  </select>
                </label>
                <button type="button" disabled={pending || !batchId || !warehouseId} onClick={loadSources}>
                  Tải nguồn xuất còn hàng
                </button>
              </>
            ) : null}
          </>
        ) : null}
        <button type="submit" disabled={pending}>
          {pending ? "Đang tạo…" : "Tạo draft"}
        </button>
        <p className="muted">Validation số lượng/UOM/quality đến từ server. Confirm chỉ qua action được bảo vệ.</p>
      </form>

      {selectedDoc ? (
        <section className="panel stack">
          <h2>Chi tiết {selectedDoc.documentNumber ?? selectedDoc.id}</h2>
          <p>Trạng thái: {selectedDoc.status ?? "—"} · phiên bản {selectedDoc.version ?? "—"}</p>
          {kind === "receivings" ? (
            <p>Đã gửi: {selectedDoc.sentQuantity ?? "—"} · thực nhận: {selectedDoc.actualQuantity ?? "—"}
              {" · "}chênh lệch: {selectedDoc.discrepancyQuantity ?? "—"}
              {" · "}lý do: {selectedDoc.discrepancyReason || "—"}
              {" · "}phản hồi nghiệp vụ: {selectedDoc.events?.reply?.status ?? "chưa gửi"}</p>
          ) : null}
          {selectedDoc.lines?.length ? (
            <ul className="task-list">
              {selectedDoc.lines.map((line, index) => <li key={`${selectedDoc.id}-${index}`}>
                Lô {line.batchId ?? "—"} · kho {line.warehouseId ?? "—"} ·{" "}
                số lượng {line.quantity ?? line.actualQuantity ?? "—"} · UOM {line.uomId ?? "—"}
              </li>)}
            </ul>
          ) : null}
          {kind === "receipts" && selectedDoc.status === "draft" && selectedDoc.lines?.length === 1 ? (
            <form className="form-grid" onSubmit={saveReceipt}>
              <label>Sửa số lượng Draft
                <input value={editQuantity} onChange={(event) => setEditQuantity(event.target.value)}
                  type="number" min="0.001" step="0.001" required disabled={pending} />
              </label>
              <button type="submit" disabled={pending}>Lưu Draft</button>
            </form>
          ) : null}
        </section>
      ) : null}

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
