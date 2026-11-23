// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useT } from "@/app/i18n/LocaleProvider";
import { useTheme, type ThemePreference } from "@/app/theme/ThemeProvider";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

function ThemeIcon({ theme }: { theme: ThemePreference }) {
  if (theme === "dark") return <Moon className="h-4 w-4" />;
  if (theme === "light") return <Sun className="h-4 w-4" />;
  return <Monitor className="h-4 w-4" />;
}

export function ThemeToggle() {
  const t = useT();
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("theme.label")}
          title={t("theme.label")}
        >
          <ThemeIcon theme={theme} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("theme.label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(v) => setTheme(v as ThemePreference)}
        >
          <DropdownMenuRadioItem value="light">
            <Sun className="mr-2 h-4 w-4" />
            {t("theme.light")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="mr-2 h-4 w-4" />
            {t("theme.dark")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="mr-2 h-4 w-4" />
            {t("theme.system")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
