// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { LogOut, Settings, User } from "lucide-react";
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
            <Button variant="outline" className="max-w-[16rem] gap-2">
              <User className="h-4 w-4 shrink-0" />
              <span className="flex min-w-0 flex-col items-start leading-tight">
                <span className="truncate font-medium">{label}</span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {roleLabel}
                </span>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-0.5">
                <span className="truncate font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">
                  {t("shell.role")}: {roleLabel}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {showAdmin ? (
              <DropdownMenuItem asChild>
                <Link href="/admin" className="cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" />
                  {t("nav.openAdmin")}
                </Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem asChild>
              <Link href="/logout" className="cursor-pointer">
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
