// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { StatusBanner } from "../../../../../components/h/status-banner";
import { ApiError, getQualityIssue } from "../../../../../lib/api-client/client";
import { requireAccessToken } from "../../../../../lib/auth/access-token";
import { currentActor } from "../../../../../lib/auth/current-actor";
import { QualityActions } from "./quality-actions";

async function loadIssue(token: string, id: string) {
  try {
    return { issue: await getQualityIssue(token, id) };
  } catch (error) {
    return {
      error: error instanceof ApiError
        ? `Không tải issue (${error.status}).`
        : "Không tải issue.",
    };
  }
}

export default async function QualityIssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await currentActor();
  const { id } = await params;
  const token = await requireAccessToken();
  const loaded = await loadIssue(token, id);
  const issue = loaded.issue;
  const sourceIds = (issue?.sourceEventIds as string[] | undefined) ?? [];

  return (
    <section className="stack">
      <p className="eyebrow">D · Data</p>
      <h1>Quality issue</h1>
      <p>
        <Link href="/data/quality">← Danh sách</Link>
      </p>
      {loaded.error ? <StatusBanner tone="error">{loaded.error}</StatusBanner> : null}
      {issue ? (
        <>
          <section className="panel">
            <p className="mono">{String(issue.id)}</p>
            <ul className="task-list">
              <li>rule: {String(issue.ruleId)}</li>
              <li>state: {String(issue.state)} · severity: {String(issue.severity)}</li>
              <li>source: {String(issue.sourceType)} / {String(issue.sourceId)}</li>
              <li>policy: {String(issue.policyVersion)} · version: {String(issue.version)}</li>
              <li>first: {String(issue.firstDetectedAt)}</li>
              <li>last: {String(issue.lastDetectedAt)}</li>
            </ul>
            <p className="muted">partner_asserted không suy thành local_verified.</p>
          </section>
          <section className="panel">
            <h2>Source events</h2>
            {!sourceIds.length
              ? <StatusBanner tone="info">Không có sourceEventIds.</StatusBanner>
              : (
                <ul className="task-list">
                  {sourceIds.map((eventId) => (
                    <li key={eventId} className="mono">{eventId}</li>
                  ))}
                </ul>
              )}
          </section>
          <QualityActions
            id={String(issue.id)}
            version={Number(issue.version)}
            state={String(issue.state)}
          />
        </>
      ) : null}
    </section>
  );
}
