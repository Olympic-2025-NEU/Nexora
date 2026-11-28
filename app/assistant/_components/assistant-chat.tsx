// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { adminApi } from "@/app/lib/admin-api";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useT } from "@/app/i18n/LocaleProvider";
import { AssistantDraft } from "./assistant-draft";
import { RiskAlerts, type RiskAlertView, type RiskUnknownView } from "./risk-alerts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Chip = { kind: string; value: string; sourceId: string; asOf: string; verification: string };
type Candidate = { batchId: string; lotCode: string; issuer: string; productName: string; sourceId: string };
type Answered = {
  status: "answered"; answer: string; connector: string | null; facts: Chip[]; sources: Chip[];
  auditRequestId: string; aiUnavailable: boolean; truncated: { balances: boolean; events: boolean };
  hidden: { balances: number; events: number }; toolCalls: number; requestId: string;
  riskAlerts?: RiskAlertView[]; riskUnknowns?: RiskUnknownView[];
};
type Ambiguous = { status: "ambiguous"; candidates: Candidate[]; requestId: string };
type NotFound = { status: "not_found"; hint: string; requestId: string };
type ChatResult = Answered | Ambiguous | NotFound;
type AskBody = { question: string; batchId?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toResult(value: unknown): ChatResult | null {
  if (!isRecord(value) || typeof value.status !== "string") return null;
  if (value.status === "answered" || value.status === "ambiguous" || value.status === "not_found") {
    return value as ChatResult;
  }
  return null;
}

function verificationLabel(value: string): string {
  if (value === "partner_asserted") return "partner_asserted";
  if (value === "missing") return "missing";
  return "local_verified";
}

export function AssistantChat() {
  const t = useT();
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChatResult | null>(null);
  const [lastAsk, setLastAsk] = useState<AskBody | null>(null);
  const [tab, setTab] = useState<"lookup" | "draft">("lookup");
  const [draftBatchId, setDraftBatchId] = useState<string | null>(null);
  const [draftSession, setDraftSession] = useState(0);

  function openDraft(batchId: string) {
    setDraftBatchId(batchId);
    setDraftSession((value) => value + 1);
    setTab("draft");
  }

  async function ask(body: AskBody) {
    setLastAsk(body);
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi("/api/v1/ai/chat", { method: "POST", body: JSON.stringify(body) });
      const json = (await res.json().catch(() => null)) as unknown;
      const data = isRecord(json) && "data" in json ? json.data : json;
      const parsed = toResult(data);
      if (!res.ok || !parsed) {
        setError(t("assistant.error"));
        return;
      }
      setResult(parsed);
    } catch {
      setError(t("assistant.error"));
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    await ask({ question: q });
  }

  async function pick(candidate: Candidate) {
    const q = question.trim();
    if (!q) return;
    await ask({ question: q, batchId: candidate.batchId });
  }

  const answeredBatchId = result?.status === "answered"
    ? result.facts.find((fact) => fact.kind === "batchCode" && UUID_RE.test(fact.sourceId))?.sourceId ?? null
    : null;
  const retryButton = lastAsk ? (
    <Button type="button" variant="outline" disabled={loading} onClick={() => void ask(lastAsk)}>
      {t("assistant.retry")}
    </Button>
  ) : null;
  const directDataLink = (
    <Link href="/inventory/balances" className="text-primary underline underline-offset-4">
      {t("assistant.directDataLink")}
    </Link>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("assistant.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("assistant.hint")}</p>
        <p role="note" className="text-xs text-muted-foreground">{t("assistant.disclaimer")}</p>
      </div>

      <div className="flex gap-2" role="tablist" aria-label={t("assistant.title")}>
        <Button type="button" role="tab" aria-selected={tab === "lookup"}
          variant={tab === "lookup" ? "default" : "outline"} onClick={() => setTab("lookup")}>
          {t("assistant.lookupTab")}
        </Button>
        <Button type="button" role="tab" aria-selected={tab === "draft"}
          variant={tab === "draft" ? "default" : "outline"} onClick={() => setTab("draft")}>
          {t("assistant.draft.tab")}
        </Button>
      </div>

      <div hidden={tab !== "lookup"} className="space-y-6">
      <form className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row" onSubmit={onSubmit}>
        <label className="flex-1 space-y-1">
          <span className="text-sm font-medium">{t("assistant.questionLabel")}</span>
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t("assistant.questionPlaceholder")}
            maxLength={300}
            required
          />
        </label>
        <div className="flex items-end">
          <Button type="submit" disabled={loading || !question.trim()}>
            {loading ? t("assistant.loading") : t("assistant.submit")}
          </Button>
        </div>
      </form>

      {error ? (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <p>{error}</p>
          {retryButton}
          {directDataLink}
        </div>
      ) : null}

      {result?.status === "not_found" ? (
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <p className="text-sm">{t("assistant.notFound")}</p>
          <Link href={result.hint || "/trace"} className="text-sm text-primary underline underline-offset-4">
            {t("assistant.traceLink")}
          </Link>
        </div>
      ) : null}

      {result?.status === "ambiguous" ? (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <h2 className="font-medium">{t("assistant.ambiguousTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("assistant.ambiguousHint")}</p>
          </div>
          <div className="space-y-2">
            {result.candidates.map((candidate) => (
              <div key={candidate.batchId} className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm">
                  <p className="font-medium">{candidate.lotCode}</p>
                  <p className="text-muted-foreground">{candidate.issuer} · {candidate.productName}</p>
                  <p className="font-mono text-xs text-muted-foreground">{candidate.batchId}</p>
                </div>
                <Button type="button" variant="outline" disabled={loading} onClick={() => void pick(candidate)}>
                  {t("assistant.select")}
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {result?.status === "answered" ? (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="space-y-2">
            <h2 className="font-medium">{t("assistant.answerTitle")}</h2>
            <p className="text-sm leading-6">{result.answer}</p>
            <p className="text-xs text-muted-foreground">
              {t("assistant.verifiedLine").replace("{count}", String(result.toolCalls ?? 0))}
            </p>
            {answeredBatchId ? (
              <Button type="button" variant="outline" onClick={() => openDraft(answeredBatchId)}>
                {t("assistant.draft.prefill")}
              </Button>
            ) : null}
          </div>

          {result.aiUnavailable && !error ? (
            <div role="alert" className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p>{t("assistant.aiUnavailable")}</p>
              <div className="flex flex-wrap items-center gap-3">
                {retryButton}
                {directDataLink}
              </div>
            </div>
          ) : null}

          {result.connector ? (
            <div className="text-sm text-muted-foreground">
              <span className="font-medium">{t("assistant.connector")}: </span>{result.connector}
            </div>
          ) : null}

          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t("assistant.sourceChip")}</h3>
            <div className="grid gap-2">
              {result.sources.map((chip, idx) => (
                <div key={`${chip.sourceId}-${chip.kind}-${idx}`} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">{chip.kind}</span>
                    <span className="font-medium">{chip.value}</span>
                    <span className="rounded border border-border px-2 py-0.5 text-xs">{verificationLabel(chip.verification)}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
                    <p>{t("assistant.sourceChip")}: <Link href="/trace" className="font-mono underline underline-offset-2">{chip.sourceId}</Link></p>
                    <p>{t("assistant.asOf")}: <span className="font-mono">{chip.asOf}</span></p>
                    <p>{t("assistant.verification")}: {chip.verification}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <RiskAlerts alerts={result.riskAlerts ?? []} unknowns={result.riskUnknowns ?? []} />
        </div>
      ) : null}
      </div>

      <div hidden={tab !== "draft"}>
        <AssistantDraft key={draftSession} batchId={draftBatchId} />
      </div>
    </div>
  );
}
