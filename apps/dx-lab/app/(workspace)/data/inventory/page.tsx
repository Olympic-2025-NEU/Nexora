// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { StatusBanner } from "../../../../components/h/status-banner";
import { ApiError, listBalances, listMovements } from "../../../../lib/api-client/client";
import { requireAccessToken } from "../../../../lib/auth/access-token";
import { currentActor } from "../../../../lib/auth/current-actor";

async function loadInventory(token: string) {
  try {
    const [balances, movements] = await Promise.all([
      listBalances(token),
      listMovements(token),
    ]);
    return { balances, movements };
  } catch (error) {
    return {
      error: error instanceof ApiError ? `Không tải tồn (${error.status}).` : "Không tải tồn.",
    };
  }
}

export default async function InventoryPage() {
  await currentActor();
  const token = await requireAccessToken();
  const loaded = await loadInventory(token);

  return (
    <section className="stack">
      <p className="eyebrow">D · Data</p>
      <h1>Tồn theo lô / kho</h1>
      {loaded.error ? <StatusBanner tone="error">{loaded.error}</StatusBanner> : null}
      {loaded.balances ? (
        !loaded.balances.length
          ? <StatusBanner tone="info">Chưa có số dư.</StatusBanner>
          : (
            <table className="data-table panel">
              <thead>
                <tr><th>Kho</th><th>Lô</th><th>Số lượng</th><th>Trace</th></tr>
              </thead>
              <tbody>
                {loaded.balances.map((row) => {
                  const batchId = String(row.batchId ?? "");
                  return (
                    <tr key={`${row.warehouseId}-${batchId}`}>
                      <td className="mono">{String(row.warehouseId)}</td>
                      <td className="mono">{batchId}</td>
                      <td>{String(row.quantity)} {String(row.unit ?? "")}</td>
                      <td><Link href={`/data/lots/${batchId}`}>Timeline</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
      ) : null}
      {loaded.movements ? (
        <section className="panel">
          <h2>Movement gần đây</h2>
          {!loaded.movements.length
            ? <StatusBanner tone="info">Chưa có movement.</StatusBanner>
            : (
              <ul className="task-list">
                {loaded.movements.slice(0, 20).map((row) => (
                  <li key={String(row.id)}>
                    {String(row.kind)} · {String(row.delta)} · bal {String(row.balanceAfter)} ·{" "}
                    <Link href={`/operations/receipts?id=${String(row.sourceDocumentId ?? "")}`}>
                      doc
                    </Link>
                  </li>
                ))}
              </ul>
            )}
        </section>
      ) : null}
    </section>
  );
}
