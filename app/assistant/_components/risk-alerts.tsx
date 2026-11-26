// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/app/lib/admin-api";
import { Button } from "@/app/components/ui/button";
import { useT } from "@/app/i18n/LocaleProvider";
import { alertFingerprint } from "@/contexts/ai/application/risk-rules";

export type RiskAlertView = {
  ruleId: "NEAR_EXPIRY" | "QUALITY_NOT_AVAILABLE" | "DISCREPANCY" | "TRACE_GAP_OR_PARTNER";
  ruleVersion: string;
  sourceIds: string[];
  asOf: string;
  severity: "Cần kiểm tra" | "Chú ý";
  explanation: string;
  fingerprint?: string;
};

export type RiskUnknownView = {
  ruleId: RiskAlertView["ruleId"];
  ruleVersion: string;
  sourceIds: string[];
  asOf: string;
  reason: string;
};

type Verdict = "correct" | "incorrect";

function severityKey(ruleId: RiskAlertView["ruleId"]): string {
  return `assistant.risk.severity.${ruleId}`;
}

export function RiskAlerts({ alerts, unknowns }: {
  alerts: RiskAlertView[];
  unknowns: RiskUnknownView[];
}) {
  const t = useT();
  const [fingerprints, setFingerprints] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<Record<string, Verdict | "error">>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    void (async () => {
      const entries = await Promise.all(alerts.map(async (alert, index) => {
        const value = alert.fingerprint ?? await alertFingerprint(alert);
        return [`${index}:${alert.ruleId}:${alert.ruleVersion}`, value] as const;
      }));
      if (active) setFingerprints(Object.fromEntries(entries));
    })();
    return () => { active = false; };
  }, [alerts]);

  async function send(alert: RiskAlertView, key: string, verdict: Verdict) {
    const fingerprint = fingerprints[key] ?? alert.fingerprint;
    if (!fingerprint || busy[key] || sent[key] === "correct" || sent[key] === "incorrect") return;
    setBusy((state) => ({ ...state, [key]: true }));
    try {
      const res = await adminApi("/api/v1/ai/risk/feedback", {
        method: "POST",
        body: JSON.stringify({ alertFingerprint: fingerprint, ruleId: alert.ruleId,
          ruleVersion: alert.ruleVersion, verdict }),
      });
      setSent((state) => ({ ...state, [key]: res.ok ? verdict : "error" }));
    } catch {
      setSent((state) => ({ ...state, [key]: "error" }));
    } finally {
      setBusy((state) => ({ ...state, [key]: false }));
    }
  }

  if (!alerts.length && !unknowns.length) return null;

  return (
    <div className="space-y-2">
      {alerts.length ? <h3 className="text-sm font-medium">{t("assistant.risk.title")}</h3> : null}
      {alerts.map((alert, index) => {
        const key = `${index}:${alert.ruleId}:${alert.ruleVersion}`;
        const verdict = sent[key];
        const disabled = busy[key] || verdict === "correct" || verdict === "incorrect";
        return (
          <div key={key} className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-border px-2 py-0.5 text-xs font-medium">
                {t(severityKey(alert.ruleId))}
              </span>
              <p className="flex-1">{alert.explanation}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("assistant.risk.ruleId")}: <span className="font-mono">{alert.ruleId}</span>
              {" · "}
              {t("assistant.risk.ruleVersion")}: <span className="font-mono">{alert.ruleVersion}</span>
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={disabled}
                onClick={() => void send(alert, key, "correct")}>
                {t("assistant.risk.feedbackCorrect")}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={disabled}
                onClick={() => void send(alert, key, "incorrect")}>
                {t("assistant.risk.feedbackIncorrect")}
              </Button>
              {verdict === "correct" || verdict === "incorrect" ? (
                <span className="text-xs text-muted-foreground">{t("assistant.risk.feedbackRecorded")}</span>
              ) : null}
              {verdict === "error" ? (
                <span role="status" className="text-xs text-destructive">{t("assistant.risk.feedbackError")}</span>
              ) : null}
            </div>
          </div>
        );
      })}
      {unknowns.map((unknown, index) => (
        <p key={`${unknown.ruleId}-${index}`} className="text-sm text-muted-foreground">
          {t("assistant.risk.unknownLine").replace("{reason}", unknown.reason)}
        </p>
      ))}
    </div>
  );
}
