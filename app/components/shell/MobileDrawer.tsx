// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect } from "react";
import { useT } from "@/app/i18n/LocaleProvider";
import { Button } from "@/app/components/ui/button";
import { AppNav } from "./AppNav";

export function MobileDrawer({
  open,
  onClose,
  roles,
}: {
  open: boolean;
  onClose: () => void;
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
    <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label={t("nav.close")}
        onClick={onClose}
      />
      <div className="absolute inset-y-0 left-0 flex w-[min(100%,18rem)] flex-col gap-4 border-r border-border bg-card p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <span className="font-semibold">{t("nav.menu")}</span>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t("nav.close")}
          </Button>
        </div>
        <AppNav roles={roles} onNavigate={onClose} />
      </div>
    </div>
  );
}
