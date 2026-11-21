// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";

export default function AdminHomePage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">System & Partner</h1>
      <p className="max-w-2xl text-slate-600">
        M01 admin surfaces for organization profile, membership (admin invite), and federated
        partners. Secrets are never shown after save; warehouse scope arrives in P06.
      </p>
      <ul className="list-disc space-y-2 pl-5 text-sm">
        <li>
          <Link className="underline" href="/admin/organization">
            Organization profile
          </Link>
        </li>
        <li>
          <Link className="underline" href="/admin/members">
            Members
          </Link>
        </li>
        <li>
          <Link className="underline" href="/admin/partners">
            Federated partners
          </Link>
        </li>
      </ul>
    </section>
  );
}
