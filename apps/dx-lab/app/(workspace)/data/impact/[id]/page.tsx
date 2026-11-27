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

export default async function ImpactPage({ params }: { params: Promise<{ id: string }> }) {
  await currentActor();
  const { id } = await params;
  const token = await requireAccessToken();
  const loaded = await loadImpact(token, id);
  const nodes = (loaded.forward?.nodes as Record<string, unknown>[] | undefined) ?? [];
  const partners = [...new Set(nodes.map((node) => String(node.issuerInstanceId ?? "")).filter(Boolean))];

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
          <ul className="task-list panel">
            {nodes.map((node) => (
              <li key={String(node.eventId)}>
                {String(node.eventType)} · doc {String(node.documentId ?? "—")} ·{" "}
                <Link href={`/data/lots/${String(node.batchId ?? id)}`}>lot</Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
