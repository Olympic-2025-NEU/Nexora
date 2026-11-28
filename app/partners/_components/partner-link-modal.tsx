// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Modal } from "@/app/components/ui/modal";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";
import { defaultNotifyUrl, normalizePartnerOrigin } from "../_lib/partner-url";
import type { PartnerRow } from "./types";

type ConnectionView = {
  partnerId: string;
  endpointHost: string;
  status: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  partner: PartnerRow | null;
  onSaved: () => void;
};

export function PartnerLinkModal({ open, onClose, partner, onSaved }: Props) {
  const t = useT();
  const [step, setStep] = useState<2 | 3>(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [endpointHost, setEndpointHost] = useState<string | null>(null);

  const [baseUrl, setBaseUrl] = useState("");
  const [notifyUrl, setNotifyUrl] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const [outboundClientId, setOutboundClientId] = useState("");
  const [outboundSecretRef, setOutboundSecretRef] = useState("");
  const [outboundAudience, setOutboundAudience] = useState("");
  const [inboundClientId, setInboundClientId] = useState("");
  const [inboundScope, setInboundScope] = useState("federation:write");

  useEffect(() => {
    if (!open || !partner) return;
    setStep(2);
    setError(null);
    setNotice(null);
    setAuthUrl("");
    setOutboundClientId("");
    setOutboundSecretRef("");
    setOutboundAudience("");
    setInboundClientId("");
    setInboundScope("federation:write");
    void (async () => {
      const connRes = await adminApi(`/api/v1/partners/${partner.id}/connection`);
      if (connRes.status === 404) {
        setEndpointHost(null);
        setBaseUrl("");
        setNotifyUrl("");
        return;
      }
      if (!connRes.ok) return;
      const json = await connRes.json();
      const view = json.data as ConnectionView;
      setEndpointHost(view.endpointHost !== "invalid" ? view.endpointHost : null);
      if (view.endpointHost && view.endpointHost !== "invalid") {
        setBaseUrl(view.endpointHost);
        setNotifyUrl(defaultNotifyUrl(view.endpointHost) ?? "");
      }
    })();
  }, [open, partner]);

  function applyBaseUrl(raw: string) {
    setBaseUrl(raw);
    const derived = defaultNotifyUrl(raw);
    if (derived) setNotifyUrl(derived);
  }

  async function saveLink() {
    if (!partner) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (
        !notifyUrl.trim() ||
        !authUrl.trim() ||
        !outboundClientId.trim() ||
        !outboundSecretRef.trim() ||
        !outboundAudience.trim() ||
        !inboundClientId.trim() ||
        !inboundScope.trim()
      ) {
        throw new Error(t("partners.fillRequired"));
      }
      const origin = normalizePartnerOrigin(baseUrl || notifyUrl);
      if (!origin && !/^https?:\/\//i.test(notifyUrl.trim())) {
        throw new Error(t("partners.fillRequired"));
      }
      const res = await adminApi(`/api/v1/partners/${partner.id}/connection`, {
        method: "PUT",
        body: JSON.stringify({
          endpointUrl: notifyUrl.trim(),
          outboundTokenUrl: authUrl.trim(),
          outboundClientId: outboundClientId.trim(),
          outboundSecretRef: outboundSecretRef.trim(),
          outboundAudience: outboundAudience.trim(),
          inboundClientId: inboundClientId.trim(),
          allowedInboundScope: inboundScope.trim(),
          status: "active",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? t("partners.saveFailed"));
      }
      setNotice(t("partners.saveOk"));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partners.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function testLink() {
    if (!partner) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await adminApi(`/api/v1/partners/${partner.id}/connection`);
      if (res.status === 404) {
        setNotice(t("partners.testMissing"));
        return;
      }
      if (!res.ok) throw new Error(t("partners.testError"));
      const json = await res.json();
      const view = json.data as ConnectionView;
      if (view.status === "disabled") setNotice(t("partners.testDisabled"));
      else setNotice(t("partners.testOk"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partners.testError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        partner
          ? `${t("partners.linkSetup")} · ${partner.displayName}`
          : t("partners.linkSetup")
      }
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("catalog.cancel")}
          </Button>
          <Button type="button" variant="outline" disabled={busy || !partner} onClick={() => void testLink()}>
            {t("partners.testLink")}
          </Button>
          {step === 2 ? (
            <Button type="button" onClick={() => setStep(3)}>
              {t("partners.next")}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setStep(2)}>
                {t("partners.back")}
              </Button>
              <Button type="button" disabled={busy || !partner} onClick={() => void saveLink()}>
                {t("partners.saveLink")}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {notice ? (
          <p role="status" className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            {notice}
          </p>
        ) : null}
        {endpointHost ? (
          <p className="text-xs text-muted-foreground">
            {t("partners.currentHost")}: <span className="font-mono">{endpointHost}</span>
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={step === 2 ? "font-semibold text-primary" : "text-muted-foreground"}>
            {t("partners.wizardStep2")}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className={step === 3 ? "font-semibold text-primary" : "text-muted-foreground"}>
            {t("partners.wizardStep3")}
          </span>
        </div>

        {step === 2 ? (
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="link-base">{t("partners.baseUrl")}</Label>
              <Input
                id="link-base"
                value={baseUrl}
                onChange={(e) => applyBaseUrl(e.target.value)}
                placeholder={t("partners.baseUrlHint")}
              />
              <p className="text-xs text-muted-foreground">{t("partners.baseUrlHint")}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="link-notify">{t("partners.notifyUrl")}</Label>
              <Input
                id="link-notify"
                value={notifyUrl}
                onChange={(e) => setNotifyUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("partners.notifyUrlHint")}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="link-auth">{t("partners.authUrl")}</Label>
              <Input
                id="link-auth"
                value={authUrl}
                onChange={(e) => setAuthUrl(e.target.value)}
                placeholder="https://…"
              />
              <p className="text-xs text-muted-foreground">{t("partners.authUrlHint")}</p>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="link-out-client">{t("partners.outboundClientId")}</Label>
                <Input
                  id="link-out-client"
                  value={outboundClientId}
                  onChange={(e) => setOutboundClientId(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="link-out-secret">{t("partners.outboundSecretRef")}</Label>
                <Input
                  id="link-out-secret"
                  value={outboundSecretRef}
                  onChange={(e) => setOutboundSecretRef(e.target.value)}
                  placeholder="env:…"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("partners.outboundSecretHint")}</p>
            <div className="grid gap-1.5">
              <Label htmlFor="link-out-aud">{t("partners.outboundAudience")}</Label>
              <Input
                id="link-out-aud"
                value={outboundAudience}
                onChange={(e) => setOutboundAudience(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="link-in-client">{t("partners.inboundClientId")}</Label>
                <Input
                  id="link-in-client"
                  value={inboundClientId}
                  onChange={(e) => setInboundClientId(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="link-in-scope">{t("partners.inboundScope")}</Label>
                <Input
                  id="link-in-scope"
                  value={inboundScope}
                  onChange={(e) => setInboundScope(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
