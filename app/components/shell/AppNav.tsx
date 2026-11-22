// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/app/i18n/LocaleProvider";
import { cn } from "@/app/lib/cn";
import { ADMIN_NAV, filterNavByRoles, type NavItem } from "./nav-config";

function NavLinks({
  items,
  onNavigate,
}: {
  items: NavItem[];
  onNavigate?: () => void;
}) {
  const t = useT();
  const pathname = usePathname();

  return (
    <ul className="flex flex-col gap-1 md:flex-row md:flex-wrap md:items-center md:gap-1">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "block rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-primary font-medium text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t(item.labelKey)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AppNav({
  roles,
  onNavigate,
}: {
  roles: string[];
  onNavigate?: () => void;
}) {
  const items = filterNavByRoles(ADMIN_NAV, roles);
  return <NavLinks items={items} onNavigate={onNavigate} />;
}
