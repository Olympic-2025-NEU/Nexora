// SPDX-License-Identifier: AGPL-3.0-only
import { notFound } from "next/navigation";
import { DocumentsPanel } from "../../../../components/p/documents-panel";
import { StatusBanner } from "../../../../components/h/status-banner";
import { ApiError, getReceivingOptions, getTradingDocument, listTradingDocuments, type TradingKind } from "../../../../lib/api-client/client";
import { requireAccessToken } from "../../../../lib/auth/access-token";
import { currentActor } from "../../../../lib/auth/current-actor";
import { loadPickerOptions } from "../../../../lib/p/load-catalog";

const kinds = new Set<TradingKind>(["receipts", "issues", "transfers", "receivings"]);
const titles: Record<TradingKind, string> = {
  receipts: "phiếu nhập",
  issues: "phiếu xuất",
  transfers: "điều chuyển",
  receivings: "nhận hàng",
};

type Doc = {
  id: string;
  documentNumber?: string;
  status?: string;
  version?: number;
  technicalAckAt?: string | null;
  lines?: { batchId?: string }[];
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadOperations(token: string, kind: TradingKind, q?: string, id?: string) {
  const docsResult = await listTradingDocuments(token, kind)
    .then((docs) => ({ docs: docs as Doc[] }))
    .catch((error: unknown) => ({
      docs: [] as Doc[],
      listError: error instanceof ApiError
        ? `Không tải được danh sách ${titles[kind]} (${error.status}). Form tạo vẫn dùng được.`
        : `Không tải được danh sách ${titles[kind]}. Form tạo vẫn dùng được.`,
    }));
  const pickersResult = await loadPickerOptions(token, q)
    .then((pickers) => ({ batches: pickers.batches, warehouses: pickers.warehouses,
      balances: pickers.balances, uoms: pickers.uoms }))
    .catch((error: unknown) => ({
      batches: [] as { id: string; label: string; productVariantId?: string }[],
      warehouses: [] as { id: string; label: string }[],
      balances: [] as { batchId: string; warehouseId: string; quantity: string; stockUomId: string }[],
      uoms: [] as { id: string; label: string }[],
      pickerError: error instanceof ApiError
        ? `Không tải catalog (${error.status}).`
        : "Không tải catalog.",
    }));
  const selectedResult = id && uuid.test(id)
    ? await getTradingDocument(token, kind, id)
      .then((selectedDoc) => ({ selectedDoc: selectedDoc as Doc }))
      .catch((error: unknown) => ({
        detailError: error instanceof ApiError ? `Không tải phiếu (${error.status}).` : "Không tải phiếu.",
      }))
    : id ? { detailError: "ID phiếu không hợp lệ." } : {};
  const receivingResult = kind === "receivings"
    ? await getReceivingOptions(token)
      .then((data) => ({ receivingMessages: Array.isArray(data.messages) ? data.messages : [] }))
      .catch((error: unknown) => ({ receivingMessages: [],
        receivingError: error instanceof ApiError ? `Không tải inbox phiếu nhận (${error.status}).`
          : "Không tải inbox phiếu nhận." }))
    : { receivingMessages: [] };
  return { ...docsResult, ...pickersResult, ...selectedResult, ...receivingResult };
}

export default async function OperationsKindPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ partnerId?: string; q?: string; id?: string }>;
}) {
  const actor = await currentActor();
  const { kind: raw } = await params;
  if (!kinds.has(raw as TradingKind)) notFound();
  const kind = raw as TradingKind;
  const query = await searchParams;
  const token = await requireAccessToken();
  const loaded = await loadOperations(token, kind, query.q, query.id);

  return (
    <section className="stack">
      <p className="eyebrow">P · Process</p>
      <h1>{titles[kind]}</h1>
      <p className="muted">
        {actor.displayName} · tenant từ session. Catalog/batch picker dùng API thật.
      </p>
      {"listError" in loaded && loaded.listError
        ? <StatusBanner tone="warning">{loaded.listError}</StatusBanner>
        : null}
      {"pickerError" in loaded && loaded.pickerError
        ? <StatusBanner tone="warning">{loaded.pickerError}</StatusBanner>
        : null}
      {"detailError" in loaded && loaded.detailError
        ? <StatusBanner tone="error">{String(loaded.detailError)}</StatusBanner>
        : null}
      {"receivingError" in loaded && loaded.receivingError
        ? <StatusBanner tone="warning">{String(loaded.receivingError)}</StatusBanner>
        : null}
      <DocumentsPanel
        key={`${kind}:${query.id ?? "list"}`}
        kind={kind}
        title={titles[kind]}
        initialDocs={loaded.docs}
        batches={loaded.batches}
        warehouses={loaded.warehouses}
        balances={loaded.balances}
        uoms={loaded.uoms}
        partnerId={typeof query.partnerId === "string" ? query.partnerId : undefined}
        selectedDoc={"selectedDoc" in loaded ? loaded.selectedDoc as Doc : undefined}
        receivingMessages={loaded.receivingMessages as {
          messageId: string; issuerInstanceId: string; sentQuantity: string;
          receivingStatus: string; sourceDocument: { id: string };
          lots: { sourceLineId: string; quantity: string; unit: "EA" | "KG" | "L" }[];
        }[]}
      />
    </section>
  );
}
