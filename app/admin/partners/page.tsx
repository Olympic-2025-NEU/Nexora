// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState } from "react";

type Partner = {
  id: string;
  code: string;
  displayName: string;
  issuerInstanceId: string;
  status: string;
  connectionStatus?: string;
  version: number;
};

export default function PartnersAdminPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/v1/partners");
        if (!res.ok) throw new Error(`Load failed (${res.status})`);
        const json = await res.json();
        setPartners(json.data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p className="text-sm text-slate-500">Loading partners…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!partners.length) {
    return (
      <p className="text-sm text-slate-500">
        No federated partners. Create via Admin API; connection secrets use references only.
      </p>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Federated partners</h1>
      <p className="text-sm text-slate-600">
        Trust id is <code>issuerInstanceId</code>, not display name or URL. Connection secrets are
        never rendered after save.
      </p>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500">
            <th className="py-2">Code</th>
            <th>Name</th>
            <th>Issuer</th>
            <th>Status</th>
            <th>Connection</th>
          </tr>
        </thead>
        <tbody>
          {partners.map((p) => (
            <tr key={p.id} className="border-b border-slate-100">
              <td className="py-2">{p.code}</td>
              <td>{p.displayName}</td>
              <td className="font-mono text-xs">{p.issuerInstanceId}</td>
              <td>{p.status}</td>
              <td>{p.connectionStatus ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
