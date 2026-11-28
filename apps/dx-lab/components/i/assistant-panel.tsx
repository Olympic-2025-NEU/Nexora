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

type DraftFields = { warehouseId: string; batchId: string; quantity: string; unit: string };

function editableFields(value: unknown): DraftFields {
  const fields = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    warehouseId: String(fields.warehouseId ?? ""),
    batchId: String(fields.batchId ?? ""),
    quantity: String(fields.quantity ?? ""),
    unit: String(fields.unit ?? ""),
  };
}

export function AssistantPanel() {
  const [question, setQuestion] = useState("");
  const [request, setRequest] = useState("");
  const [answer, setAnswer] = useState<Record<string, unknown> | null>(null);
  const [proposal, setProposal] = useState<Record<string, unknown> | null>(null);
  const [draftFields, setDraftFields] = useState<DraftFields>(editableFields(null));
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
      setDraftFields(editableFields(result.data.fields));
    });
  }

  function createDraft() {
    if (!proposal || proposal.status !== "proposed") return;
    const proposalId = String(proposal.proposalId ?? "");
    if (!proposalId || Object.values(draftFields).some((value) => !value.trim()) ||
        !Number.isFinite(Number(draftFields.quantity)) || Number(draftFields.quantity) <= 0) {
      setError("Proposal thiếu fields/proposalId.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await aiDraftCreateAction({ proposalId, fields: draftFields });
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
                ? <StatusBanner tone="warning">Model tạm không sẵn sàng. Xem dữ liệu trực tiếp tại <Link href="/data/lots">Danh sách lô</Link>.</StatusBanner>
                : null}
              <h3>Nguồn và thời điểm</h3>
              <ul className="task-list">
                {(Array.isArray(answer.sources) ? answer.sources : []).map((source, index) => {
                  const item = source as Record<string, unknown>;
                  return <li key={`${String(item.sourceId ?? "")}-${index}`}>
                    {String(item.kind ?? "dữ liệu")} · {String(item.value ?? "")} ·{" "}
                    nguồn {String(item.sourceId ?? "—")} · asOf {String(item.asOf ?? "—")} ·{" "}
                    xác minh {String(item.verification ?? "—")}
                  </li>;
                })}
              </ul>
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
          {proposal.status !== "proposed"
            ? <pre className="mono">{JSON.stringify(proposal.candidates ?? proposal, null, 2)}</pre>
            : null}
          {Array.isArray(proposal.warnings) && proposal.warnings.length ? (
            <StatusBanner tone="warning">
              Cảnh báo: {proposal.warnings.map((warning) =>
                String((warning as { message?: string }).message ?? "Kiểm tra lại dữ liệu nguồn"))
                .join("; ")}
            </StatusBanner>
          ) : null}
          {Array.isArray(proposal.sources) && proposal.sources.length ? (
            <p className="muted">Nguồn đề xuất: {proposal.sources.map((source) => {
              const item = source as Record<string, unknown>;
              return `${String(item.sourceId ?? "—")} (${String(item.asOf ?? "—")}, ${
                String(item.verification ?? "—")})`;
            }).join("; ")}</p>
          ) : null}
          {proposal.status === "proposed" ? (
            <form className="form-grid" onSubmit={(event) => { event.preventDefault(); createDraft(); }}>
              <p>Kiểm tra và sửa các trường trước khi tạo Draft. Đây là thao tác riêng của bạn; AI không xác nhận phiếu.</p>
              {(["warehouseId", "batchId", "quantity", "unit"] as const).map((field) => (
                <label key={field}>{field}
                  <input value={draftFields[field]} required disabled={pending || "created" in proposal}
                    onChange={(event) => setDraftFields((current) => ({ ...current, [field]: event.target.value }))} />
                </label>
              ))}
              <button type="submit" disabled={pending || "created" in proposal}>
                {pending ? "Đang tạo…" : "Tạo Draft M03"}
              </button>
            </form>
          ) : null}
          {"created" in proposal ? (
            <StatusBanner tone="success">
              Đã tạo Draft. <Link href={`/operations/receipts?id=${encodeURIComponent(String(
                (proposal.created as { draftDocumentId?: string }).draftDocumentId ?? "",
              ))}`}>Mở phiếu để xem, sửa hoặc confirm theo quyền M03</Link>.
            </StatusBanner>
          ) : null}
          <p className="muted">UI không tự confirm khi model nói “đã xong”.</p>
        </section>
      ) : null}
    </div>
  );
}
