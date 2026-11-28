// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { StatusBanner } from "../../../../../components/h/status-banner";
import { QrIssuer } from "../../../../../components/d/qr-issuer";
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

export default async function LotDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ backPage?: string; forwardPage?: string }>;
}) {
  await currentActor();
  const { id } = await params;
  const token = await requireAccessToken();
  const loaded = await loadLot(token, id);
  const events = (loaded.history?.events as Record<string, unknown>[] | undefined) ?? [];
  const otReadings = (loaded.history?.otReadings as Record<string, unknown>[] | undefined) ?? [];
  const backNodes = (loaded.backward?.nodes as Record<string, unknown>[] | undefined) ?? [];
  const forwardNodes = (loaded.forward?.nodes as Record<string, unknown>[] | undefined) ?? [];
  const query = await searchParams;
  const pageFor = (raw: string | undefined, count: number) => Math.min(
    Math.max(1, Number.isSafeInteger(Number(raw)) ? Number(raw) : 1),
    Math.max(1, Math.ceil(count / 20)),
  );
  const backPage = pageFor(query.backPage, backNodes.length);
  const forwardPage = pageFor(query.forwardPage, forwardNodes.length);

  return (
    <section className="stack">
      <p className="eyebrow">D · Data</p>
      <h1>Timeline lô</h1>
      <p className="mono">{id}</p>
      <p>
        <Link href={`/data/impact/${id}`}>Impact graph</Link>
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
            <h2>OT readings (simulated)</h2>
            <p className="muted">Thiết bị mô phỏng — không tự đổi stock/quality.</p>
            {!otReadings.length
              ? <StatusBanner tone="info">Chưa có ot_reading.</StatusBanner>
              : (
                <ul className="task-list">
                  {otReadings.map((reading) => (
                    <li key={String(reading.id)}>
                      {String(reading.deviceId)} · {String(reading.value)}{String(reading.unit)} ·{" "}
                      {String(reading.qualityState)} · lag {String(reading.lagSeconds)}s · asOf {String(reading.asOf)}
                      {reading.simulated ? " · simulated" : ""}
                    </li>
                  ))}
                </ul>
              )}
          </section>
          <section className="panel">
            <h2>Backward</h2>
            <p className="muted">{backNodes.length} node(s) — số liệu từ API, không hardcode.</p>
            <ul className="task-list">
              {backNodes.slice((backPage - 1) * 20, backPage * 20).map((node) => (
                <li key={String(node.eventId)}>
                  {String(node.eventType)} · {String(node.verificationState)} · {String(node.issuerInstanceId)}
                </li>
              ))}
            </ul>
            <nav aria-label="Trang truy ngược" className="actions">
              {backPage > 1 ? <Link href={`/data/lots/${id}?backPage=${backPage - 1}&forwardPage=${forwardPage}`}>Trước</Link> : null}
              <span>Trang {backPage}/{Math.max(1, Math.ceil(backNodes.length / 20))}</span>
              {backPage * 20 < backNodes.length ? <Link href={`/data/lots/${id}?backPage=${backPage + 1}&forwardPage=${forwardPage}`}>Sau</Link> : null}
            </nav>
          </section>
          <section className="panel">
            <h2>Forward</h2>
            <p className="muted">{forwardNodes.length} node(s)</p>
            <ul className="task-list">
              {forwardNodes.slice((forwardPage - 1) * 20, forwardPage * 20).map((node) => (
                <li key={String(node.eventId)}>
                  {String(node.eventType)} · {String(node.verificationState)} · {String(node.issuerInstanceId)}
                </li>
              ))}
            </ul>
            <nav aria-label="Trang truy xuôi" className="actions">
              {forwardPage > 1 ? <Link href={`/data/lots/${id}?backPage=${backPage}&forwardPage=${forwardPage - 1}`}>Trước</Link> : null}
              <span>Trang {forwardPage}/{Math.max(1, Math.ceil(forwardNodes.length / 20))}</span>
              {forwardPage * 20 < forwardNodes.length ? <Link href={`/data/lots/${id}?backPage=${backPage}&forwardPage=${forwardPage + 1}`}>Sau</Link> : null}
            </nav>
          </section>
        </>
      ) : null}
      <QrIssuer batchId={id} />
    </section>
  );
}
