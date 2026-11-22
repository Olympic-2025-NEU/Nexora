// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useLocale } from "@/app/i18n/LocaleProvider";
import type { Locale } from "@/app/i18n/dictionaries";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";

export function LanguageToggle({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();

  return (
    <Select
      value={locale}
      onValueChange={(v) => setLocale(v as Locale)}
    >
      <SelectTrigger
        className={`w-[4.5rem] ${className}`}
        aria-label={t("shell.language")}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="vi">VI</SelectItem>
        <SelectItem value="en">EN</SelectItem>
      </SelectContent>
    </Select>
  );
}
