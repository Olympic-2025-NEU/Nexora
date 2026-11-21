// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState } from "react";

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
  const [org, setOrg] = useState<Org | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/organization");
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const json = await res.json();
      setOrg(json.data);
      setName(json.data.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      setOrg(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!org) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/organization", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
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

  if (loading) return <p className="text-sm text-slate-500">Loading organization…</p>;
  if (error && !org) return <p className="text-sm text-red-600">{error}</p>;
  if (!org) return <p className="text-sm text-slate-500">No organization found. Run seed.</p>;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Organization</h1>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="text-slate-500">Code</dt>
          <dd>{org.code}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Status / version</dt>
          <dd>
            {org.status} · v{org.version}
          </dd>
        </div>
      </dl>
      <label className="block space-y-1 text-sm">
        <span>Name</span>
        <input
          className="w-full rounded border border-slate-300 px-3 py-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </section>
  );
}
