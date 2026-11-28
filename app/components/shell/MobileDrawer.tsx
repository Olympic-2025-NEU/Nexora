// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { Settings } from "lucide-react";
import { useEffect } from "react";
import { useT } from "@/app/i18n/LocaleProvider";
import { Button } from "@/app/components/ui/button";
import { AppSidebar } from "./AppSidebar";
import { isAdministrator, type NavGroup } from "./nav-config";

export function MobileDrawer({
  open,
  onClose,
  groups,
  roles,
}: {
  open: boolean;
  onClose: () => void;
  groups: NavGroup[];
  roles: string[];
}) {
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label={t("nav.close")}
        onClick={onClose}
      />
      <div className="absolute inset-y-0 left-0 flex max-w-[100%] shadow-xl">
        <div className="flex h-full flex-col bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="font-semibold">{t("nav.menu")}</span>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t("nav.close")}
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <AppSidebar
              groups={groups}
              hoverFlyout={false}
              onNavigate={onClose}
              className="h-full w-56 border-r-0"
            />
          </div>
          {isAdministrator(roles) ? (
            <div className="border-t border-border p-3">
              <Button asChild variant="secondary" className="w-full justify-start">
                <Link href="/admin" onClick={onClose}>
                  <Settings className="mr-2 h-4 w-4" />
                  {t("nav.openAdmin")}
                </Link>
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
