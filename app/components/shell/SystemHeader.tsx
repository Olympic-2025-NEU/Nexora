// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { Bell, Menu, Search } from "lucide-react";
import { useT } from "@/app/i18n/LocaleProvider";
import { Button } from "@/app/components/ui/button";
import { UserMenu } from "./UserMenu";

export function SystemHeader({
  userId,
  displayName,
  roles,
  onOpenMobileNav,
}: {
  userId: string;
  displayName?: string | null;
  roles: string[];
  onOpenMobileNav: () => void;
}) {
  const t = useT();

  return (
    <header
      className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/80 px-4 backdrop-blur-xl lg:px-6"
      data-purpose="top-system-bar"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="md:hidden"
          onClick={onOpenMobileNav}
          aria-label={t("nav.menu")}
        >
          <Menu className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div
          data-purpose="quick-search-trigger"
          className="hidden h-9 w-56 items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 text-sm text-muted-foreground md:flex lg:w-72"
          title={t("shell.searchUnavailable")}
          aria-disabled="true"
        >
          <Search className="h-4 w-4 shrink-0 opacity-70" />
          <span className="min-w-0 flex-1 truncate">{t("shell.searchPlaceholder")}</span>
          <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("shell.searchSoonTag")}
          </span>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label={t("shell.notifications")}>
          <span className="relative">
            <Bell className="h-4 w-4" />
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-destructive" />
          </span>
        </Button>
        <UserMenu userId={userId} displayName={displayName} roles={roles} />
      </div>
    </header>
  );
}
