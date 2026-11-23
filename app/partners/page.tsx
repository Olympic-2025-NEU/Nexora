// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState } from "react";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";

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
  const t = useT();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const res = await adminApi("/api/v1/partners");
        if (res.status === 403) throw new Error(t("admin.forbidden"));
        if (!res.ok) throw new Error(`${t("admin.loadFailed")} (${res.status})`);
        const json = await res.json();
        setPartners(json.data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("admin.loadFailed"));
      } finally {
        setLoading(false);
      }
    })();
  }, [t]);

  if (loading) return <p className="text-sm text-slate-500">{t("admin.loading")}</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!partners.length) {
    return (
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">{t("admin.partnersTitle")}</h1>
        <p className="text-sm text-slate-500">{t("admin.empty")}</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("admin.partnersTitle")}</h1>
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
