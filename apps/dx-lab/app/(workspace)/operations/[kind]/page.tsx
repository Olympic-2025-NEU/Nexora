// SPDX-License-Identifier: AGPL-3.0-only
import { notFound } from "next/navigation";
import { DocumentsPanel } from "../../../../components/p/documents-panel";
import { StatusBanner } from "../../../../components/h/status-banner";
import { ApiError, listTradingDocuments, type TradingKind } from "../../../../lib/api-client/client";
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

async function loadOperations(token: string, kind: TradingKind, q?: string) {
  const docsResult = await listTradingDocuments(token, kind)
    .then((docs) => ({ docs: docs as Doc[] }))
    .catch((error: unknown) => ({
      docs: [] as Doc[],
      listError: error instanceof ApiError
        ? `Không tải được danh sách ${titles[kind]} (${error.status}). Form tạo vẫn dùng được.`
        : `Không tải được danh sách ${titles[kind]}. Form tạo vẫn dùng được.`,
    }));
  const pickersResult = await loadPickerOptions(token, q)
    .then((pickers) => ({ batches: pickers.batches, warehouses: pickers.warehouses }))
    .catch((error: unknown) => ({
      batches: [] as { id: string; label: string; productVariantId?: string }[],
      warehouses: [] as { id: string; label: string }[],
      pickerError: error instanceof ApiError
        ? `Không tải catalog (${error.status}).`
        : "Không tải catalog.",
    }));
  return { ...docsResult, ...pickersResult };
}

export default async function OperationsKindPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ partnerId?: string; q?: string }>;
}) {
  const actor = await currentActor();
  const { kind: raw } = await params;
  if (!kinds.has(raw as TradingKind)) notFound();
  const kind = raw as TradingKind;
  const query = await searchParams;
  const token = await requireAccessToken();
  const loaded = await loadOperations(token, kind, query.q);

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
      <DocumentsPanel
        kind={kind}
        title={titles[kind]}
        initialDocs={loaded.docs}
        batches={loaded.batches}
        warehouses={loaded.warehouses}
        partnerId={typeof query.partnerId === "string" ? query.partnerId : undefined}
      />
    </section>
  );
}
