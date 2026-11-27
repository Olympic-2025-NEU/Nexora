// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { StatusBanner } from "../../../../components/h/status-banner";
import { ApiError, listQualityIssues } from "../../../../lib/api-client/client";
import { requireAccessToken } from "../../../../lib/auth/access-token";
import { currentActor } from "../../../../lib/auth/current-actor";

async function loadIssues(token: string) {
  try {
    const open = await listQualityIssues(token, { state: "open" });
    const ack = await listQualityIssues(token, { state: "acknowledged" });
    return { rows: [...open, ...ack] };
  } catch (error) {
    return {
      error: error instanceof ApiError
        ? `Không tải quality issues (${error.status}). Admin only.`
        : "Không tải quality issues.",
    };
  }
}

export default async function QualityIssuesPage() {
  await currentActor();
  const token = await requireAccessToken();
  const loaded = await loadIssues(token);
  const rows = loaded.rows ?? [];

  return (
    <section className="stack">
      <p className="eyebrow">D · Data</p>
      <h1>Quality issues</h1>
      <p className="muted">
        Cảnh báo vận hành — không cấp quyền event sai; partner_asserted ≠ verified.
      </p>
      {loaded.error ? <StatusBanner tone="error">{loaded.error}</StatusBanner> : null}
      {!loaded.error && !rows.length
        ? <StatusBanner tone="info">Không có issue open/acknowledged.</StatusBanner>
        : null}
      {rows.length ? (
        <ul className="task-list">
          {rows.map((row) => (
            <li key={String(row.id)}>
              <Link href={`/data/quality/${String(row.id)}`}>
                {String(row.ruleId)} · {String(row.severity)} · {String(row.state)}
              </Link>
              {" · "}
              {String(row.sourceType)}/{String(row.sourceId).slice(0, 8)}…
              {" · "}
              last {String(row.lastDetectedAt)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
