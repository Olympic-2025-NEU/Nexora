// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { StatusBanner } from "../../../../../components/h/status-banner";
import { ApiError, getLotHistory, getLotTrace } from "../../../../../lib/api-client/client";
import { requireAccessToken } from "../../../../../lib/auth/access-token";
import { currentActor } from "../../../../../lib/auth/current-actor";

async function loadLot(token: string, id: string) {
  try {
    const [history, backward, forward] = await Promise.all([
      getLotHistory(token, id),
      getLotTrace(token, id, "backward"),
      getLotTrace(token, id, "forward"),
    ]);
    return { history, backward, forward };
  } catch (error) {
    return {
      error: error instanceof ApiError ? `Không tải timeline (${error.status}).` : "Không tải timeline.",
    };
  }
}

export default async function LotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await currentActor();
  const { id } = await params;
  const token = await requireAccessToken();
  const loaded = await loadLot(token, id);
  const events = (loaded.history?.events as Record<string, unknown>[] | undefined) ?? [];
  const backNodes = (loaded.backward?.nodes as Record<string, unknown>[] | undefined) ?? [];
  const forwardNodes = (loaded.forward?.nodes as Record<string, unknown>[] | undefined) ?? [];

  return (
    <section className="stack">
      <p className="eyebrow">D · Data</p>
      <h1>Timeline lô</h1>
      <p className="mono">{id}</p>
      <p>
        <Link href={`/data/impact/${id}`}>Impact graph</Link>
        {" · "}
        <Link href="/passport/demo">Passport (token)</Link>
      </p>
      {loaded.error ? <StatusBanner tone="error">{loaded.error}</StatusBanner> : null}
      {!loaded.error ? (
        <>
          <section className="panel">
            <h2>History</h2>
            {!events.length
              ? <StatusBanner tone="info">Chưa có event lịch sử.</StatusBanner>
              : (
                <ul className="task-list">
                  {events.map((event) => (
                    <li key={String(event.eventId)}>
                      {String(event.type)} · {String(event.issuer)} · {String(event.verificationState)}
                      {event.gap ? " · gap" : ""}
                      {event.sourceDocumentId
                        ? <> · <Link href={`/operations/receipts?id=${String(event.sourceDocumentId)}`}>doc</Link></>
                        : null}
                    </li>
                  ))}
                </ul>
              )}
          </section>
          <section className="panel">
            <h2>Backward</h2>
            <p className="muted">{backNodes.length} node(s) — số liệu từ API, không hardcode.</p>
            <ul className="task-list">
              {backNodes.slice(0, 20).map((node) => (
                <li key={String(node.eventId)}>
                  {String(node.eventType)} · {String(node.verificationState)} · {String(node.issuerInstanceId)}
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <h2>Forward</h2>
            <p className="muted">{forwardNodes.length} node(s)</p>
            <ul className="task-list">
              {forwardNodes.slice(0, 20).map((node) => (
                <li key={String(node.eventId)}>
                  {String(node.eventType)} · {String(node.verificationState)} · {String(node.issuerInstanceId)}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </section>
  );
}
