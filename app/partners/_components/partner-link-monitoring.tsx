// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";

type Case = { messageId: string; eventType: string; errorCode: string | null; ageSeconds: number };
type Gap = Case & { inboxId: string; issuerInstanceId: string; state: string };
type Receipt = { transferId: string; state: string; ageSeconds: number };
type Lookup = {
  outbox: {
    outboxId: string;
    envelopeMessageId: string | null;
    eventType: string;
    status: string;
    correlationId: string | null;
    errorCode: string | null;
    attempts: {
      number: number;
      result: string;
      httpStatus: number | null;
      errorCode: string | null;
    }[];
  }[];
  inbox: {
    inboxId: string;
    issuerInstanceId: string;
    messageId: string;
    eventType: string;
    state: string;
    errorCode: string | null;
    ackStatus: string | null;
  }[];
};
type Operations = {
  instanceId: string;
  queue: Record<string, number>;
  queueOldestAgeSeconds: number;
  attempts: Record<string, number>;
  inbox: Record<string, number>;
  receipts: Record<string, number>;
  deadLetters: Case[];
  mappingGaps: Gap[];
  receiptCases: Receipt[];
  lookup: Lookup | null;
};

function Counts({ title, data }: { title: string; data: Record<string, number> }) {
  return (
    <section className="rounded-lg border border-border bg-muted/20 p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
        {Object.entries(data).map(([key, count]) => (
          <div key={key}>
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="font-semibold">{count}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Embedded notice-queue monitoring for the unified partner connection screen. */
export function PartnerLinkMonitoring() {
  const t = useT();
  const [data, setData] = useState<Operations | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(
    async (messageId = "") => {
      try {
        const url = `/api/v1/admin/federation/operations${
          messageId ? `?messageId=${encodeURIComponent(messageId)}` : ""
        }`;
        const response = await adminApi(url);
        if (response.status === 403) {
          setForbidden(true);
          setData(null);
          return;
        }
        if (!response.ok) {
          setNotice(`${t("linkOps.loadFailed")} (${response.status}).`);
          return;
        }
        setForbidden(false);
        setData((await response.json()) as Operations);
        setNotice("");
      } catch {
        setNotice(t("linkOps.connectFailed"));
      }
    },
    [t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function operate(path: string, body: object) {
    setBusy(true);
    try {
      const response = await adminApi(path, { method: "POST", body: JSON.stringify(body) });
      const result = (await response.json()) as {
        code?: string;
        state?: string;
        status?: string;
      };
      setNotice(
        response.ok
          ? `${t("linkOps.actionOk")}: ${result.state ?? result.status ?? "pending"}.`
          : `${t("linkOps.actionFailed")} (${response.status}, ${result.code ?? "—"}).`,
      );
      await load(query.trim());
    } catch {
      setNotice(t("linkOps.connectFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) return null;

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4" data-purpose="partner-link-monitoring">
      <div>
        <h2 className="text-sm font-semibold">{t("linkOps.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("linkOps.subtitle")}</p>
        {data?.instanceId ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("linkOps.instanceLabel")}: {data.instanceId}
          </p>
        ) : null}
      </div>
      {notice ? (
        <p role="status" className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          {notice}
        </p>
      ) : null}
      {data ? (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <Counts
              title={`${t("linkOps.queue")} · ${t("linkOps.oldest")} ${data.queueOldestAgeSeconds}s`}
              data={data.queue}
            />
            <Counts title={t("linkOps.attempts")} data={data.attempts} />
            <Counts title={t("linkOps.inbox")} data={data.inbox} />
            <Counts title={t("linkOps.receipts")} data={data.receipts} />
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void load(query.trim());
            }}
          >
            <div className="grid min-w-[16rem] flex-1 gap-1.5">
              <Label htmlFor="partner-notice-id">{t("linkOps.messageId")}</Label>
              <Input
                id="partner-notice-id"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("linkOps.messageIdPlaceholder")}
              />
            </div>
            <Button type="submit" variant="outline">
              {t("linkOps.lookup")}
            </Button>
            <Button type="button" variant="outline" onClick={() => void load(query.trim())}>
              {t("linkOps.reload")}
            </Button>
          </form>
          {data.lookup ? (
            <div className="space-y-2 rounded-md border border-border p-3 text-sm">
              <h3 className="font-semibold">{t("linkOps.journey")}</h3>
              {data.lookup.outbox.map((row) => (
                <div key={row.outboxId} className="break-all border-t border-border/60 pt-2">
                  {row.eventType} · {row.status} · {row.envelopeMessageId ?? "—"} ·{" "}
                  {row.errorCode ?? "—"}
                  <ul className="mt-1 text-muted-foreground">
                    {row.attempts.map((attempt) => (
                      <li key={attempt.number}>
                        #{attempt.number}: {attempt.result} · {attempt.httpStatus ?? "—"} ·{" "}
                        {attempt.errorCode ?? "—"}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {data.lookup.inbox.map((row) => (
                <div key={row.inboxId} className="break-all border-t border-border/60 pt-2">
                  {row.issuerInstanceId}/{row.messageId} · {row.eventType} · {row.state} ·{" "}
                  {row.ackStatus ?? "—"} · {row.errorCode ?? "—"}
                </div>
              ))}
              {!data.lookup.outbox.length && !data.lookup.inbox.length ? (
                <p>{t("linkOps.notFoundOnInstance")}</p>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-3 lg:grid-cols-3">
            <section className="space-y-2 rounded-md border border-border p-3 text-sm">
              <h3 className="font-semibold">{t("linkOps.deadLetters")}</h3>
              {data.deadLetters.map((row) => (
                <div key={row.messageId} className="break-all border-t border-border/60 py-2">
                  {row.messageId} · {row.eventType} · {row.errorCode ?? "—"} · {row.ageSeconds}s
                  <button
                    type="button"
                    disabled={busy}
                    className="ml-2 text-primary underline disabled:opacity-50"
                    onClick={() =>
                      void operate("/api/v1/admin/retries", { messageId: row.messageId })
                    }
                  >
                    {t("linkOps.retry")}
                  </button>
                </div>
              ))}
              {!data.deadLetters.length ? <p>{t("linkOps.none")}</p> : null}
            </section>
            <section className="space-y-2 rounded-md border border-border p-3 text-sm">
              <h3 className="font-semibold">{t("linkOps.mappingGaps")}</h3>
              {data.mappingGaps.map((row) => (
                <div key={row.inboxId} className="break-all border-t border-border/60 py-2">
                  {row.issuerInstanceId}/{row.messageId} · {row.state} · {row.errorCode ?? "—"} ·{" "}
                  {row.ageSeconds}s
                  {row.state === "pending_dependency" ? (
                    <button
                      type="button"
                      disabled={busy}
                      className="ml-2 text-primary underline disabled:opacity-50"
                      onClick={() =>
                        void operate("/api/v1/admin/federation/operations", {
                          action: "reprocess",
                          inboxId: row.inboxId,
                        })
                      }
                    >
                      {t("linkOps.reprocess")}
                    </button>
                  ) : null}
                </div>
              ))}
              {!data.mappingGaps.length ? <p>{t("linkOps.none")}</p> : null}
            </section>
            <section className="space-y-2 rounded-md border border-border p-3 text-sm">
              <h3 className="font-semibold">{t("linkOps.receiptCases")}</h3>
              {data.receiptCases.map((row) => (
                <div key={row.transferId} className="break-all border-t border-border/60 py-2">
                  {row.transferId} · {row.state} · {row.ageSeconds}s
                </div>
              ))}
              {!data.receiptCases.length ? <p>{t("linkOps.none")}</p> : null}
            </section>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>
      )}
    </section>
  );
}
