// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState } from "react";

type Member = {
  id: string;
  displayName: string;
  role: string;
  status: string;
  version: number;
};

export default function MembersAdminPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/v1/members");
        if (!res.ok) throw new Error(`Load failed (${res.status})`);
        const json = await res.json();
        setMembers(json.data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p className="text-sm text-slate-500">Loading members…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!members.length) {
    return <p className="text-sm text-slate-500">No members yet. Invite via POST /api/v1/members.</p>;
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Members</h1>
      <p className="text-sm text-slate-600">
        Admin invite only — password never stored in app DB. Disable takes effect on next API call.
      </p>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500">
            <th className="py-2">Name</th>
            <th>Role</th>
            <th>Status</th>
            <th>Version</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} className="border-b border-slate-100">
              <td className="py-2">{m.displayName}</td>
              <td>{m.role}</td>
              <td>{m.status}</td>
              <td>v{m.version}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
