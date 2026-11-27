// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import {
  aiChatAction,
  aiDraftCreateAction,
  aiDraftProposeAction,
} from "../../lib/i/actions";
import { StatusBanner } from "../h/status-banner";

export function AssistantPanel() {
  const [question, setQuestion] = useState("");
  const [request, setRequest] = useState("");
  const [answer, setAnswer] = useState<Record<string, unknown> | null>(null);
  const [proposal, setProposal] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function ask(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await aiChatAction({ question: question.trim() });
      if (!result.ok) {
        setError(result.message);
        setAnswer(null);
        return;
      }
      setAnswer(result.data);
    });
  }

  function propose(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await aiDraftProposeAction({ request: request.trim() });
      if (!result.ok) {
        setError(result.message);
        setProposal(null);
        return;
      }
      setProposal(result.data);
    });
  }

  function createDraft() {
    if (!proposal || proposal.status !== "proposed") return;
    const fields = proposal.fields as Record<string, string> | undefined;
    const proposalId = String(proposal.proposalId ?? "");
    if (!fields || !proposalId) {
      setError("Proposal thiếu fields/proposalId.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await aiDraftCreateAction({ proposalId, fields });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setProposal({ ...proposal, created: result.data });
    });
  }

  return (
    <div className="stack">
      {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}
      <form className="panel form-grid" onSubmit={ask}>
        <h2>Hỏi lô (sourced)</h2>
        <label>Câu hỏi
          <input value={question} onChange={(e) => setQuestion(e.target.value)} required />
        </label>
        <button type="submit" disabled={pending}>{pending ? "Đang hỏi…" : "Hỏi"}</button>
      </form>
      {answer ? (
        <section className="panel">
          <h2>Trả lời · {String(answer.status)}</h2>
          {answer.status === "answered" ? (
            <>
              <p>{String(answer.answer)}</p>
              {answer.aiUnavailable
                ? <StatusBanner tone="warning">Provider down — dùng facts deterministic / fallback trực tiếp.</StatusBanner>
                : null}
              <p className="muted">
                Sources: {JSON.stringify(answer.sources ?? [])}
              </p>
              {"riskAlerts" in answer && Array.isArray(answer.riskAlerts) && answer.riskAlerts.length
                ? (
                  <StatusBanner tone="warning">
                    Risk: {answer.riskAlerts.map((alert) =>
                      String((alert as { ruleId?: string }).ruleId ?? alert)).join(", ")}
                  </StatusBanner>
                )
                : null}
            </>
          ) : null}
          {answer.status === "ambiguous" ? (
            <StatusBanner tone="info">Cần disambiguation: {JSON.stringify(answer.candidates)}</StatusBanner>
          ) : null}
          {answer.status === "not_found" ? (
            <StatusBanner tone="info">{String(answer.hint ?? "Không tìm thấy lô.")}</StatusBanner>
          ) : null}
        </section>
      ) : null}

      <form className="panel form-grid" onSubmit={propose}>
        <h2>Draft suggestion (receipt)</h2>
        <label>Yêu cầu
          <input value={request} onChange={(e) => setRequest(e.target.value)} required />
        </label>
        <button type="submit" disabled={pending}>{pending ? "Đang đề xuất…" : "Đề xuất draft"}</button>
      </form>
      {proposal ? (
        <section className="panel">
          <h2>Proposal · {String(proposal.status)}</h2>
          <pre className="mono">{JSON.stringify(proposal.fields ?? proposal.candidates ?? proposal, null, 2)}</pre>
          {proposal.status === "proposed" ? (
            <div className="actions">
              <button type="button" disabled={pending} onClick={createDraft}>
                Tạo draft M03 (human action)
              </button>
              <Link href="/operations/receipts">Mở form phiếu nhập</Link>
            </div>
          ) : null}
          {"created" in proposal ? (
            <StatusBanner tone="success">
              Đã tạo draft {String((proposal.created as { draftDocumentId?: string }).draftDocumentId)}.
              AI không tự confirm.
            </StatusBanner>
          ) : null}
          <p className="muted">UI không tự confirm khi model nói “đã xong”.</p>
        </section>
      ) : null}
    </div>
  );
}
