// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Image from "next/image";
import Link from "next/link";
import { LanguageToggle } from "@/app/components/shell/LanguageToggle";
import { ThemeToggle } from "@/app/components/shell/ThemeToggle";
import { Button } from "@/app/components/ui/button";
import { useT } from "@/app/i18n/LocaleProvider";

export function ResetPasswordClient({
  accountUrl,
}: {
  accountUrl: string | null;
}) {
  const t = useT();

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-foreground">
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <Link href="/" className="flex flex-col items-center gap-2">
        <Image
          src="/assets/Nexora.png"
          alt={t("brand.name")}
          width={64}
          height={64}
          priority
        />
      </Link>
      <section className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h1 className="text-xl font-semibold">{t("auth.resetTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("auth.resetBody")}</p>
        {accountUrl ? (
          <Button asChild>
            <a href={accountUrl} target="_blank" rel="noreferrer">
              {t("auth.resetOpen")}
            </a>
          </Button>
        ) : (
          <p className="text-sm text-destructive" role="status">
            {t("auth.resetUnavailable")}
          </p>
        )}
        <div className="flex gap-4 text-sm">
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            {t("nav.login")}
          </Link>
          <Link href="/" className="text-muted-foreground underline-offset-4 hover:underline">
            {t("auth.backHome")}
          </Link>
        </div>
      </section>
    </main>
  );
}
