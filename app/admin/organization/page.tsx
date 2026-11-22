// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";

type Org = {
  id: string;
  code: string;
  name: string;
  timezone: string;
  status: string;
  version: number;
  contactEmail?: string;
};

export default function OrganizationAdminPage() {
  const t = useT();
  const [org, setOrg] = useState<Org | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    try {
      const res = await adminApi("/api/v1/organization");
      if (res.status === 403) throw new Error(t("admin.forbidden"));
      if (!res.ok) throw new Error(`${t("admin.loadFailed")} (${res.status})`);
      const json = await res.json();
      setOrg(json.data);
      setName(json.data.name);
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
    // Initial fetch only; `t` is stable enough for labels on first paint.
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
        body: JSON.stringify({ name, version: org.version }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const json = await res.json();
      setOrg(json.data);
      setName(json.data.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;
  if (error && !org) return <p className="text-sm text-destructive">{error}</p>;
  if (!org) return <p className="text-sm text-muted-foreground">{t("admin.empty")}</p>;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("admin.organizationTitle")}</h1>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Code</dt>
          <dd>{org.code}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status / version</dt>
          <dd>
            {org.status} · v{org.version}
          </dd>
        </div>
      </dl>
      <div className="max-w-lg space-y-1.5">
        <Label htmlFor="org-name">Name</Label>
        <Input
          id="org-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <Button type="button" disabled={saving} onClick={() => void save()}>
        {saving ? t("admin.loading") : t("admin.save")}
      </Button>
    </section>
  );
}
