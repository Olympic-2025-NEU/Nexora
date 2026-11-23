// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { adminApi } from "@/app/lib/admin-api";

type Task = { approvalRequestId: string; documentId: string; documentNumber: string; creatorSub: string;
  ageSeconds: number; lineHash: string; processDefinitionVersion: number };

export function ApprovalsClient() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [waiting, setWaiting] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const refresh = useCallback(async () => {
    const response = await adminApi("/api/v1/approvals/inbox");
    if (!response.ok) throw new Error((await response.json()).error ?? "Không tải được hộp duyệt.");
    setTasks((await response.json()).data as Task[]);
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void refresh().catch((cause: Error) => setError(cause.message)); });
    return () => { active = false; };
  }, [refresh]);
  async function decide(task: Task, decision: "approve" | "reject") {
    setBusy(task.approvalRequestId); setError("");
    try {
      const response = await adminApi(`/api/v1/approvals/${task.approvalRequestId}/decisions`, {
        method: "POST", headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ decision, ...(notes[task.approvalRequestId]?.trim() &&
          { note: notes[task.approvalRequestId].trim() }) }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Không ghi được quyết định.");
      setWaiting((current) => ({ ...current, [task.approvalRequestId]: "Đang chờ workflow engine" }));
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Lỗi duyệt."); }
    finally { setBusy(""); }
  }
  return <main className="mx-auto max-w-5xl space-y-5 p-6">
    <h1 className="text-2xl font-semibold">Hộp phê duyệt phiếu xuất</h1>
    <Link className="underline" href="/trading/issues">Phiếu xuất</Link>
    <button className="ml-4 underline" onClick={() => void refresh().catch((cause: Error) => setError(cause.message))}>Tải lại</button>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {Object.entries(waiting).map(([id, state]) => <p role="status" key={id}>{id.slice(0, 8)} · {state} ·
      <Link className="underline" href={`/trading/issues/${tasks.find((task) => task.approvalRequestId === id)?.documentId ?? ""}`}>Xem phiếu</Link></p>)}
    {!tasks.length && <p>Không có task đang chờ quyết định.</p>}
    <ul className="space-y-4">{tasks.map((task) => <li key={task.approvalRequestId} className="space-y-2 rounded border p-4">
      <Link className="font-medium underline" href={`/trading/issues/${task.documentId}`}>{task.documentNumber}</Link>
      <p>Người tạo: {task.creatorSub} · Tuổi: {Math.floor(task.ageSeconds / 60)} phút · Hash: {task.lineHash.slice(0, 12)} · BPMN v{task.processDefinitionVersion}</p>
      <label className="block">Ghi chú<input className="block w-full border p-2" maxLength={2000}
        value={notes[task.approvalRequestId] ?? ""}
        onChange={(event) => setNotes((current) => ({ ...current, [task.approvalRequestId]: event.target.value }))} /></label>
      <div className="flex gap-4"><button disabled={!!busy || !!waiting[task.approvalRequestId]}
        onClick={() => void decide(task, "approve")}>Approve</button>
        <button disabled={!!busy || !!waiting[task.approvalRequestId] || !notes[task.approvalRequestId]?.trim()}
          onClick={() => void decide(task, "reject")}>Reject</button></div>
    </li>)}</ul>
  </main>;
}
