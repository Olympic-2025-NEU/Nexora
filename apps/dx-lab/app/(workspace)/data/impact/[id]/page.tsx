// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { StatusBanner } from "../../../../../components/h/status-banner";
import { ApiError, getLotTrace } from "../../../../../lib/api-client/client";
import { requireAccessToken } from "../../../../../lib/auth/access-token";
import { currentActor } from "../../../../../lib/auth/current-actor";

async function loadImpact(token: string, id: string) {
  try {
    return { forward: await getLotTrace(token, id, "forward") };
  } catch (error) {
    return {
      error: error instanceof ApiError ? `Không tải impact (${error.status}).` : "Không tải impact.",
    };
  }
}

export default async function ImpactPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ issuer?: string; page?: string }>;
}) {
  await currentActor();
  const { id } = await params;
  const token = await requireAccessToken();
  const loaded = await loadImpact(token, id);
  const nodes = (loaded.forward?.nodes as Record<string, unknown>[] | undefined) ?? [];
  const partners = [...new Set(nodes.map((node) => String(node.issuerInstanceId ?? "")).filter(Boolean))];
  const query = await searchParams;
  const issuer = partners.includes(query.issuer ?? "") ? query.issuer ?? "" : "";
  const filtered = issuer ? nodes.filter((node) => node.issuerInstanceId === issuer) : nodes;
  const page = Math.max(1, Number.isSafeInteger(Number(query.page)) ? Number(query.page) : 1);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const href = (target: number) => `/data/impact/${id}?issuer=${encodeURIComponent(issuer)}&page=${target}`;

  return (
    <section className="stack">
      <p className="eyebrow">D · Data</p>
      <h1>Impact</h1>
      <p className="mono">{id}</p>
      {loaded.error ? <StatusBanner tone="error">{loaded.error}</StatusBanner> : null}
      {!loaded.error ? (
        <>
          <StatusBanner tone="info">
            Partners/issuers bị ảnh hưởng: {partners.length ? partners.join(", ") : "không có"}
          </StatusBanner>
          <form className="form-grid panel" method="get">
            <label>Lọc issuer
              <select name="issuer" defaultValue={issuer}>
                <option value="">Tất cả</option>
                {partners.map((partner) => <option key={partner} value={partner}>{partner}</option>)}
              </select>
            </label>
            <button type="submit">Lọc</button>
          </form>
          <ul className="task-list panel">
            {filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((node) => (
              <li key={String(node.eventId)}>
                {String(node.eventType)} · doc {String(node.documentId ?? "—")} ·{" "}
                <Link href={`/data/lots/${String(node.batchId ?? id)}`}>lot</Link>
              </li>
            ))}
          </ul>
          <nav aria-label="Trang impact" className="actions">
            {currentPage > 1 ? <Link href={href(currentPage - 1)}>Trang trước</Link> : null}
            <span>Trang {currentPage}/{pageCount} · {filtered.length} sự kiện</span>
            {currentPage < pageCount ? <Link href={href(currentPage + 1)}>Trang sau</Link> : null}
          </nav>
        </>
      ) : null}
    </section>
  );
}
