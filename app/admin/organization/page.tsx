// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { PageHeader } from "@/app/components/ui/page-header";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";

type Org = {
  id: string;
  instanceId: string;
  code: string;
  name: string;
  timezone: string;
  status: string;
  version: number;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
};

export default function OrganizationAdminPage() {
  const t = useT();
  const [org, setOrg] = useState<Org | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState("Asia/Ho_Chi_Minh");

  function applyOrg(next: Org) {
    setOrg(next);
    setName(next.name ?? "");
    setContactEmail(next.contactEmail ?? "");
    setContactPhone(next.contactPhone ?? "");
    setAddress(next.address ?? "");
    setTimezone(next.timezone ?? "Asia/Ho_Chi_Minh");
  }

  async function load() {
    setError(null);
    try {
      const res = await adminApi("/api/v1/organization");
      if (res.status === 403) throw new Error(t("admin.forbidden"));
      if (!res.ok) throw new Error(`${t("admin.loadFailed")} (${res.status})`);
      const json = await res.json();
      applyOrg(json.data as Org);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.loadFailed"));
      setOrg(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount load
  }, []);

  async function save() {
    if (!org) return;
    setSaving(true);
    setError(null);
    try {
      const res = await adminApi("/api/v1/organization", {
        method: "PATCH",
        headers: {
          "if-match": String(org.version),
        },
        body: JSON.stringify({
          name: name.trim(),
          contactEmail: contactEmail.trim() || null,
          contactPhone: contactPhone.trim() || null,
          address: address.trim() || null,
          timezone: timezone.trim(),
          version: org.version,
        }),
      });
      if (!res.ok) throw new Error(`${t("admin.saveFailed")} (${res.status})`);
      const json = await res.json();
      applyOrg(json.data as Org);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;
  if (error && !org) return <p className="text-sm text-destructive">{error}</p>;
  if (!org) return <p className="text-sm text-muted-foreground">{t("admin.empty")}</p>;

  return (
    <section className="w-full space-y-6">
      <PageHeader
        title={t("admin.organizationTitle")}
        description={t("admin.organizationBody")}
        actions={
          <Button type="button" variant="outline" onClick={() => void load()}>
            {t("admin.refresh")}
          </Button>
        }
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("admin.orgCode")}
          </p>
          <p className="mt-1 text-lg font-semibold">{org.code}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("admin.orgStatus")}
          </p>
          <p className="mt-1 text-lg font-semibold capitalize">{org.status}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("admin.orgVersion")}
          </p>
          <p className="mt-1 text-lg font-semibold">v{org.version}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("admin.orgInstanceId")}
          </p>
          <p className="mt-1 truncate text-sm font-medium" title={org.instanceId}>
            {org.instanceId}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
        <h2 className="mb-4 text-base font-semibold">{t("admin.orgProfile")}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="org-name">{t("admin.orgName")}</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="organization"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-email">{t("admin.orgEmail")}</Label>
            <Input
              id="org-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-phone">{t("admin.orgPhone")}</Label>
            <Input
              id="org-phone"
              type="tel"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              autoComplete="tel"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="org-address">{t("admin.orgAddress")}</Label>
            <Input
              id="org-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              autoComplete="street-address"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-timezone">{t("admin.orgTimezone")}</Label>
            <Input
              id="org-timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Asia/Ho_Chi_Minh"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("admin.orgCode")}</Label>
            <Input value={org.code} disabled readOnly />
            <p className="text-xs text-muted-foreground">{t("admin.orgImmutableHint")}</p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button type="button" disabled={saving || !name.trim()} onClick={() => void save()}>
            {saving ? t("admin.loading") : t("admin.save")}
          </Button>
        </div>
      </div>
    </section>
  );
}
