// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { useT } from "@/app/i18n/LocaleProvider";
import { cn } from "@/app/lib/cn";
import type { NavItem } from "./nav-config";

export function AppNav({
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
      {items.map((item, index) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        const showHeading =
          index === 0 || items[index - 1].section !== item.section;
        return (
          <Fragment key={item.href}>
            {showHeading ? (
              <li
                className={cn(
                  "px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                  index === 0 && "pt-0",
                )}
              >
                {t(item.section)}
              </li>
            ) : null}
            <li>
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
          </Fragment>
        );
      })}
    </ul>
  );
}
