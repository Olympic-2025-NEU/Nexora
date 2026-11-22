// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect } from "react";
import { useT } from "@/app/i18n/LocaleProvider";
import { logoutAndRedirect } from "@/app/lib/session";

export default function LogoutPage() {
  const t = useT();

  useEffect(() => {
    logoutAndRedirect("/");
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <p className="text-sm text-slate-600">{t("auth.logoutTitle")}</p>
    </main>
  );
}
