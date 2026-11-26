// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { adminApi } from "@/app/lib/admin-api";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useT } from "@/app/i18n/LocaleProvider";

type Fields = { warehouseId: string; batchId: string; quantity: string; unit: string };
type Source = { kind: string; value: string; sourceId: string; asOf: string; verification: string };
type Warning = { code: string; message: string; sourceId?: string };
type Candidate = { batchId: string; lotCode: string; issuer: string; productName: string; sourceId: string };
type Created = { proposalId: string; draftDocumentId: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMPTY_FIELDS: Fields = { warehouseId: "", batchId: "", quantity: "", unit: "" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function unwrap(value: unknown): unknown {
  return isRecord(value) && "data" in value ? value.data : value;
}

function requestId(): string {
  const raw = globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return raw.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 128);
}

function readFields(value: unknown): Fields {
  const row = isRecord(value) ? value : {};
  return {
    warehouseId: typeof row.warehouseId === "string" ? row.warehouseId : "",
    batchId: typeof row.batchId === "string" ? row.batchId : "",
    quantity: typeof row.quantity === "string" ? row.quantity : "",
    unit: typeof row.unit === "string" ? row.unit : "",
  };
}

function readSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((row) => ({
    kind: typeof row.kind === "string" ? row.kind : "",
    value: typeof row.value === "string" ? row.value : "",
    sourceId: typeof row.sourceId === "string" ? row.sourceId : "",
    asOf: typeof row.asOf === "string" ? row.asOf : "",
    verification: typeof row.verification === "string" ? row.verification : "",
  }));
}

function readWarnings(value: unknown): Warning[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((row) => ({
    code: typeof row.code === "string" ? row.code : "",
    message: typeof row.message === "string" ? row.message : "",
    ...(typeof row.sourceId === "string" ? { sourceId: row.sourceId } : {}),
  }));
}

function readCandidates(value: unknown): Candidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((row) => ({
    batchId: typeof row.batchId === "string" ? row.batchId : "",
    lotCode: typeof row.lotCode === "string" ? row.lotCode : "",
    issuer: typeof row.issuer === "string" ? row.issuer : "",
    productName: typeof row.productName === "string" ? row.productName : "",
    sourceId: typeof row.sourceId === "string" ? row.sourceId : "",
  }));
}

function verificationLabel(value: string): string {
  if (value === "partner_asserted") return "partner_asserted";
  if (value === "missing") return "missing";
  return "local_verified";
}

export function AssistantDraft({ batchId }: { batchId?: string | null }) {
  const t = useT();
  const [request, setRequest] = useState("");
  const [fields, setFields] = useState<Fields>({ ...EMPTY_FIELDS, batchId: batchId ?? "" });
  const [sources, setSources] = useState<Source[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [note, setNote] = useState("");
  const [proposing, setProposing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRequestId = useRef<string | null>(null);
  const proposeInFlight = useRef(false);
  const createInFlight = useRef(false);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function propose(next: { request?: string; fields?: Fields; batchId?: string | null }): Promise<void> {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (proposeInFlight.current) return;
    proposeInFlight.current = true;
    const nextRequestId = requestId();
    setProposing(true);
    setError(null);
    setMessage(null);
    setCandidates([]);
    const nextFields = next.fields ?? fields;
    const nextRequest = next.request ?? request;
    const body: Record<string, unknown> = { fields: nextFields };
    if (nextRequest.trim()) body.request = nextRequest.trim();
    const lot = typeof next.batchId === "string" ? next.batchId.trim() : nextFields.batchId.trim();
    if (lot) {
      if (UUID_RE.test(lot)) body.batchId = lot;
      else body.lotCode = lot;
    }
    try {
      const res = await adminApi("/api/v1/ai/draft", {
        method: "POST",
        headers: { "x-request-id": nextRequestId },
        body: JSON.stringify(body),
      });
      const data = unwrap(await res.json().catch(() => null));
      if (!res.ok || !isRecord(data) || typeof data.status !== "string") {
        setError(t("assistant.draft.proposeError"));
        return;
      }
      if (data.status === "ambiguous") {
        setCandidates(readCandidates(data.candidates));
        setMessage(t("assistant.draft.ambiguous"));
        setProposalId(null);
        setStale(true);
        return;
      }
      if (!["proposed", "incomplete", "empty"].includes(data.status)) {
        setError(t("assistant.draft.proposeError"));
        return;
      }
      setFields(readFields(data.fields));
      setSources(readSources(data.sources));
      setWarnings(readWarnings(data.warnings));
      const nextProposalId = typeof data.proposalId === "string" ? data.proposalId : null;
      setProposalId(nextProposalId);
      if (nextProposalId) activeRequestId.current = nextRequestId;
      setStale(false);
      if (data.status === "empty") setMessage(t("assistant.draft.empty"));
      if (data.status === "incomplete") setMessage(t("assistant.draft.incomplete"));
    } catch {
      setError(t("assistant.draft.proposeError"));
    } finally {
      setProposing(false);
      proposeInFlight.current = false;
    }
  }

  function invalidate(nextFields: Fields): void {
    setProposalId(null);
    setStale(true);
    setMessage(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void propose({ request, fields: nextFields });
    }, 350);
  }

  function changeField(key: keyof Fields, value: string): void {
    const next = { ...fields, [key]: value };
    setFields(next);
    invalidate(next);
  }

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const requestIdForCreate = activeRequestId.current;
    if (!proposalId || !requestIdForCreate || stale || proposing || creating || created || createInFlight.current) return;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    createInFlight.current = true;
    setCreating(true);
    setError(null);
    try {
      const res = await adminApi("/api/v1/ai/draft/create", {
        method: "POST",
        headers: { "x-request-id": requestIdForCreate },
        body: JSON.stringify({ proposalId, fields, ...(note ? { note } : {}) }),
      });
      const data = unwrap(await res.json().catch(() => null));
      if (!res.ok || !isRecord(data) || typeof data.draftDocumentId !== "string") {
        setError(t("assistant.draft.createError"));
        return;
      }
      setCreated({ proposalId, draftDocumentId: data.draftDocumentId });
    } catch {
      setError(t("assistant.draft.createError"));
    } finally {
      setCreating(false);
      createInFlight.current = false;
    }
  }

  const busy = proposing || creating;

  function warningText(warning: Warning): string {
    const key = `assistant.draft.warning.${warning.code}`;
    const label = t(key);
    return label === key ? warning.message : label;
  }

  return (
    <section className="space-y-5" aria-label={t("assistant.draft.title")}>
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t("assistant.draft.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("assistant.draft.hint")}</p>
      </div>

      <div role="status" className="rounded-md border border-border bg-muted p-3 text-sm">
        {created
          ? t("assistant.draft.phaseAfter").replace("{id}", created.draftDocumentId)
          : t("assistant.draft.phaseBefore")}
      </div>
      <p className="rounded-md border border-border bg-card p-3 text-sm font-medium">
        {t("assistant.draft.steps")}
      </p>

      {created ? (
        <div className="space-y-2 rounded-md border border-border bg-card p-3 text-sm">
          <p className="font-mono">{created.draftDocumentId}</p>
          <Link href={`/trading/history/${created.draftDocumentId}`} className="text-primary underline underline-offset-4">
            {t("assistant.draft.open")}
          </Link>
        </div>
      ) : null}

      <form className="space-y-3 rounded-lg border border-border bg-card p-4" onSubmit={(event) => {
        event.preventDefault();
        void propose({ request, fields });
      }}>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("assistant.draft.requestLabel")}</span>
          <Input
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            placeholder={t("assistant.draft.requestPlaceholder")}
            maxLength={300}
            disabled={busy || !!created}
          />
        </label>
        <Button type="submit" variant="outline" disabled={busy || !!created || (!request.trim() && !fields.batchId.trim())}>
          {t("assistant.draft.propose")}
        </Button>
      </form>

      {error ? (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {message ? (
        <div role="status" className="rounded-md border border-border bg-muted p-3 text-sm">{message}</div>
      ) : null}

      {candidates.length ? (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          <h3 className="font-medium">{t("assistant.draft.ambiguous")}</h3>
          {candidates.map((candidate) => (
            <div key={candidate.batchId} className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm">
                <p className="font-medium">{candidate.lotCode}</p>
                <p className="text-muted-foreground">{candidate.issuer} · {candidate.productName}</p>
                <p className="font-mono text-xs text-muted-foreground">{candidate.batchId}</p>
              </div>
              <Button type="button" variant="outline" disabled={busy} onClick={() => {
                void propose({ batchId: candidate.batchId, fields: { ...fields, batchId: candidate.batchId } });
              }}>
                {t("assistant.draft.select")}
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="font-medium">{t("assistant.draft.fieldsTitle")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium">{t("assistant.draft.warehouse")}</span>
            <Input value={fields.warehouseId} onChange={(event) => changeField("warehouseId", event.target.value)}
              maxLength={80} disabled={busy || !!created} className="font-mono text-xs" />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">{t("assistant.draft.batch")}</span>
            <Input value={fields.batchId} onChange={(event) => changeField("batchId", event.target.value)}
              maxLength={100} disabled={busy || !!created} className="font-mono text-xs" />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">{t("assistant.draft.quantity")}</span>
            <Input value={fields.quantity} onChange={(event) => changeField("quantity", event.target.value)}
              maxLength={20} inputMode="decimal" disabled={busy || !!created} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">{t("assistant.draft.unit")}</span>
            <Input value={fields.unit} onChange={(event) => changeField("unit", event.target.value)}
              maxLength={20} disabled={busy || !!created} />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("assistant.draft.note")}</span>
          <textarea
            className="block w-full rounded-md border border-input bg-card p-2 text-sm"
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={busy || !!created}
          />
          <span className="text-xs text-muted-foreground">{t("assistant.draft.noteHint")}</span>
        </label>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t("assistant.draft.sources")}</h3>
        <div className="grid gap-2">
          {sources.map((chip, index) => (
            <div key={`${chip.sourceId}-${chip.kind}-${index}`} className="rounded-md border border-border bg-card p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-muted px-2 py-0.5 text-xs">{chip.kind}</span>
                <span className="font-medium">{chip.value}</span>
                <span className="rounded border border-border px-2 py-0.5 text-xs">{verificationLabel(chip.verification)}</span>
              </div>
              <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                <p>{t("assistant.sourceChip")}: <Link href="/trace" className="font-mono underline underline-offset-2">{chip.sourceId}</Link></p>
                <p>{t("assistant.asOf")}: <span className="font-mono">{chip.asOf}</span></p>
                <p>{t("assistant.verification")}: {chip.verification}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {warnings.length ? (
        <div role="alert" className="space-y-2">
          <h3 className="text-sm font-medium">{t("assistant.draft.warnings")}</h3>
          {warnings.map((warning, index) => (
            <div key={`${warning.code}-${index}`} className={`rounded-md border p-3 text-sm ${
              warning.code === "quality_not_available"
                ? "border-destructive/50 bg-destructive/10 text-destructive"
                : "border-amber-500/40 bg-amber-500/10"
            }`}>
              <p className="font-medium">{warningText(warning)}</p>
              {warning.sourceId ? (
                <Link href="/trace" className="font-mono text-xs underline underline-offset-2">{warning.sourceId}</Link>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {creating ? (
        <p role="status" className="text-sm text-muted-foreground">{t("assistant.draft.creating")}</p>
      ) : null}

      <form onSubmit={(event) => void create(event)}>
        <Button type="submit" disabled={!proposalId || stale || busy || !!created}>
          {t("assistant.draft.create")}
        </Button>
      </form>
    </section>
  );
}
