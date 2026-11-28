// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { useT } from "@/app/i18n/LocaleProvider";
import { cn } from "@/app/lib/cn";
import { isPathActive, type NavGroup } from "./nav-config";

export function NavFlyout({
  group,
  onNavigate,
  className,
  style,
  onMouseEnter,
  onMouseLeave,
}: {
  group: NavGroup;
  onNavigate?: () => void;
  className?: string;
  style?: CSSProperties;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const t = useT();
  const pathname = usePathname();
  const children = group.children ?? [];

  return (
    <section
      className={cn(
        "flex w-64 flex-col rounded-lg border border-border bg-card p-1.5 shadow-[var(--overlay-shadow)]",
        className,
      )}
      style={style}
      data-purpose="nav-flyout"
      aria-label={group.flyoutTitleKey ? t(group.flyoutTitleKey) : t(group.labelKey)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <nav className="max-h-[min(28rem,calc(100vh-6rem))] space-y-0.5 overflow-y-auto">
        {children.map((item) => {
          const active = isPathActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "block rounded-md border px-2.5 py-1.5 transition-colors",
                active
                  ? "border-primary/30 bg-accent text-accent-foreground"
                  : "border-transparent hover:border-border hover:bg-muted",
              )}
            >
              <span className="block text-sm font-medium leading-snug">{t(item.labelKey)}</span>
              {item.descriptionKey ? (
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                  {t(item.descriptionKey)}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </section>
  );
}
