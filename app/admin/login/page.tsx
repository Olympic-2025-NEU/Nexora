// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function RedirectLogin() {
  const router = useRouter();
  const search = useSearchParams();

  useEffect(() => {
    const next = search.get("next");
    const qs = next ? `?next=${encodeURIComponent(next)}` : "";
    router.replace(`/login${qs}`);
  }, [router, search]);

  return (
    <p className="text-sm text-slate-500">Redirecting to /login…</p>
  );
}

/** Deprecated: use `/login`. Kept for bookmark compatibility. */
export default function AdminLoginRedirectPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Redirecting…</p>}>
      <RedirectLogin />
    </Suspense>
  );
}
