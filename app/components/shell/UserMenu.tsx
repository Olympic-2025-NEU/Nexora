// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { Building2, LogOut, Settings, Shield, User } from "lucide-react";
import { useT } from "@/app/i18n/LocaleProvider";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";
import { isAdministrator, primaryRole } from "./nav-config";

function initials(name: string | null | undefined, userId: string | null): string {
  const raw = (name && name.trim()) || userId || "?";
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return raw.slice(0, 2).toUpperCase();
}

export function UserMenu({
  userId,
  displayName,
  roles,
}: {
  userId: string | null;
  displayName?: string | null;
  roles: string[];
}) {
  const t = useT();
  const role = primaryRole(roles);
  const roleLabel =
    t(`roles.${role}`) !== `roles.${role}` ? t(`roles.${role}`) : role;
  const showAdmin = isAdministrator(roles);
  const label =
    (displayName && displayName.trim()) ||
    (userId ? userId.slice(0, 8) : null);

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <LanguageToggle />
      <ThemeToggle />
      {userId ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="max-w-[16rem] gap-2 rounded-full px-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                {initials(displayName, userId)}
              </span>
              <span className="hidden min-w-0 flex-col items-start leading-tight sm:flex">
                <span className="truncate font-medium">{label}</span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {roleLabel}
                </span>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-72 shadow-[var(--overlay-shadow)]"
            data-purpose="user-menu-popover"
          >
            <DropdownMenuLabel className="font-normal">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {initials(displayName, userId)}
                </span>
                <div className="min-w-0 flex flex-col gap-0.5">
                  <span className="truncate font-medium">{label}</span>
                  <span className="inline-flex w-fit rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    {t("shell.role")}: {roleLabel}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/admin/organization" className="cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                {t("shell.profile")}
              </Link>
            </DropdownMenuItem>
            {showAdmin ? (
              <DropdownMenuItem asChild>
                <Link href="/admin/members" className="cursor-pointer">
                  <Shield className="mr-2 h-4 w-4" />
                  {t("shell.rolesAndPermissions")}
                </Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem asChild>
              <Link href="/admin" className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                {t("shell.accountSettings")}
              </Link>
            </DropdownMenuItem>
            {showAdmin ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("shell.enterpriseSection")}
                </DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href="/admin/organization" className="cursor-pointer">
                    <Building2 className="mr-2 h-4 w-4" />
                    {t("shell.enterpriseManage")}
                  </Link>
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/logout" className="cursor-pointer text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                {t("nav.logout")}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button asChild>
          <Link href="/login">{t("nav.login")}</Link>
        </Button>
      )}
    </div>
  );
}
