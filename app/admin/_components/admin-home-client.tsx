// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ADMIN_NAV, filterNavByRoles } from "@/app/components/shell/nav-config";
import { useT } from "@/app/i18n/LocaleProvider";
import { fetchMe, getAccessToken } from "@/app/lib/session";

export function AdminHomeClient() {
  const t = useT();
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    if (!getAccessToken()) return;
    void fetchMe().then((me) => {
      if (me) setRoles(me.roles);
    });
  }, []);

  const items = roles.length ? filterNavByRoles(ADMIN_NAV, roles) : [];

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("admin.hubTitle")}</h1>
      <p className="max-w-2xl text-muted-foreground">{t("admin.hubBody")}</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              className="block rounded-lg border border-border bg-card px-4 py-3 text-sm text-card-foreground transition-colors hover:border-primary hover:bg-accent"
              href={item.href}
            >
              {t(item.labelKey)}
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-sm">
        <Link href="/catalog/products" className="text-primary underline-offset-4 hover:underline">
          {t("home.ctaCatalog")}
        </Link>
      </p>
    </section>
  );
}
