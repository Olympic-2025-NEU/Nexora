// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Image from "next/image";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { LanguageToggle } from "@/app/components/shell/LanguageToggle";
import { ThemeToggle } from "@/app/components/shell/ThemeToggle";
import { Button } from "@/app/components/ui/button";
import { useT } from "@/app/i18n/LocaleProvider";
import { hasSession } from "@/app/lib/session";

function subscribeSession(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

export default function Home() {
  const t = useT();
  const signedIn = useSyncExternalStore(
    subscribeSession,
    () => hasSession(),
    () => false,
  );

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-6 overflow-hidden bg-background px-6 text-center text-foreground">
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <Image
        src="/assets/Nexora.png"
        alt={t("brand.name")}
        width={112}
        height={112}
        className="h-28 w-28 object-contain drop-shadow-sm"
        priority
      />
      <h1 className="text-5xl font-semibold tracking-tight">{t("home.title")}</h1>
      <p className="max-w-xl text-lg text-muted-foreground">{t("brand.tagline")}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {signedIn ? (
          <Button asChild size="lg">
            <Link href="/admin">{t("home.ctaAdmin")}</Link>
          </Button>
        ) : (
          <Button asChild size="lg">
            <Link href="/login">{t("home.ctaLogin")}</Link>
          </Button>
        )}
      </div>
    </main>
  );
}
