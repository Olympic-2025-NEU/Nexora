// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { StatusBanner } from "../../../../components/h/status-banner";
import { ApiError, listBatches } from "../../../../lib/api-client/client";
import { requireAccessToken } from "../../../../lib/auth/access-token";
import { currentActor } from "../../../../lib/auth/current-actor";

async function loadLots(token: string, q?: string) {
  try {
    return { batches: await listBatches(token, q) };
  } catch (error) {
    return {
      error: error instanceof ApiError ? `Không tải lô (${error.status}).` : "Không tải lô.",
    };
  }
}

export default async function LotsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await currentActor();
  const { q } = await searchParams;
  const token = await requireAccessToken();
  const loaded = await loadLots(token, q);

  return (
    <section className="stack">
      <p className="eyebrow">D · Data</p>
      <h1>Lô hàng</h1>
      <form className="panel form-grid" method="get">
        <label>Tìm (q)
          <input name="q" defaultValue={q ?? ""} placeholder="localCode / issuer / uuid" />
        </label>
        <button type="submit">Tìm</button>
      </form>
      {loaded.error ? <StatusBanner tone="error">{loaded.error}</StatusBanner> : null}
      {loaded.batches ? (
        !loaded.batches.length
          ? <StatusBanner tone="info">Không có lô.</StatusBanner>
          : (
            <table className="data-table panel">
              <thead>
                <tr><th>Mã</th><th>Issuer</th><th>Quality</th><th></th></tr>
              </thead>
              <tbody>
                {loaded.batches.map((batch) => {
                  const origin = batch.originLot as { issuerInstanceId?: string } | undefined;
                  return (
                    <tr key={String(batch.id)}>
                      <td>{String(batch.localCode)}</td>
                      <td className="mono">{origin?.issuerInstanceId ?? "—"}</td>
                      <td>{String(batch.qualityStatus)}</td>
                      <td>
                        <Link href={`/data/lots/${String(batch.id)}`}>Timeline</Link>
                        {" · "}
                        <Link href={`/data/impact/${String(batch.id)}`}>Impact</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
      ) : null}
    </section>
  );
}
