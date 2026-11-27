// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ApprovalTask } from "../../lib/api-client/openapi-types";
import { decideApprovalAction } from "../../lib/p/actions";
import { StatusBanner } from "../h/status-banner";

export function ApprovalsPanel({ initialTasks }: { initialTasks: ApprovalTask[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [waiting, setWaiting] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(task: ApprovalTask, decision: "approve" | "reject") {
    setError(null);
    startTransition(async () => {
      const note = notes[task.approvalRequestId]?.trim();
      if (decision === "reject" && !note) {
        setError("Reject cần lý do.");
        return;
      }
      const result = await decideApprovalAction(
        task.approvalRequestId,
        decision,
        task.approvalVersion,
        note,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setWaiting((current) => ({
        ...current,
        [task.approvalRequestId]: "decision_pending — chờ worker/Flowable đối soát",
      }));
      setTasks((rows) => rows.filter((row) => row.approvalRequestId !== task.approvalRequestId));
    });
  }

  return (
    <div className="stack">
      {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}
      {!tasks.length
        ? <StatusBanner tone="info">Không có task đang chờ quyết định.</StatusBanner>
        : null}
      {Object.entries(waiting).map(([id, state]) => (
        <StatusBanner key={id} tone="warning">{id.slice(0, 8)} · {state}</StatusBanner>
      ))}
      <ul className="task-list">
        {tasks.map((task) => (
          <li key={task.approvalRequestId} className="panel">
            <p>
              <strong>{task.documentNumber}</strong> · {task.documentType} · v{task.approvalVersion}
              {" "}· {Math.floor(task.ageSeconds / 60)} phút
            </p>
            <p className="muted">
              evidence: {(task.evidenceFileIds ?? []).length
                ? task.evidenceFileIds!.join(", ")
                : "không có"}
            </p>
            <label>Ghi chú
              <input
                value={notes[task.approvalRequestId] ?? ""}
                onChange={(e) => setNotes((current) => ({
                  ...current,
                  [task.approvalRequestId]: e.target.value,
                }))}
              />
            </label>
            <div className="actions">
              <button type="button" disabled={pending} onClick={() => decide(task, "approve")}>
                Approve
              </button>
              <button type="button" disabled={pending} onClick={() => decide(task, "reject")}>
                Reject
              </button>
              <Link href={`/operations/issues?id=${task.documentId}`}>Xem phiếu</Link>
            </div>
          </li>
        ))}
      </ul>
      <p className="muted">Người tạo không tự duyệt (server 403). UI không gọi Flowable admin.</p>
    </div>
  );
}
