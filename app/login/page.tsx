// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { LanguageToggle } from "@/app/components/shell/LanguageToggle";
import { ThemeToggle } from "@/app/components/shell/ThemeToggle";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { useT } from "@/app/i18n/LocaleProvider";
import { loginWithPassword } from "@/app/lib/session";

function LoginForm() {
  const t = useT();
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/admin";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await loginWithPassword({ username, password, totp: totp.trim() || undefined });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.replace(next.startsWith("/") ? next : "/admin");
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm"
    >
      <h1 className="text-xl font-semibold">{t("auth.loginTitle")}</h1>
      <p className="text-sm text-muted-foreground">{t("auth.loginHint")}</p>
      <div className="space-y-1.5">
        <Label htmlFor="username">{t("auth.username")}</Label>
        <Input
          id="username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">{t("auth.password")}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="totp">{t("auth.totp")}</Label>
        <Input id="totp" inputMode="numeric" autoComplete="one-time-code"
          pattern="[0-9]{6,8}" value={totp} onChange={(event) => setTotp(event.target.value)} />
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? t("auth.signingIn") : t("auth.submit")}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <Link href="/reset-password" className="text-primary underline-offset-4 hover:underline">
          {t("auth.forgot")}
        </Link>
        <Link href="/" className="text-muted-foreground underline-offset-4 hover:underline">
          {t("auth.backHome")}
        </Link>
      </div>
    </form>
  );
}

export default function LoginPage() {
  const t = useT();

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4">
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <Link href="/" className="flex flex-col items-center gap-2">
        <Image
          src="/assets/Nexora.png"
          alt={t("brand.name")}
          width={72}
          height={72}
          priority
        />
        <span className="text-2xl font-semibold tracking-tight">{t("brand.name")}</span>
      </Link>
      <Suspense fallback={<p className="text-sm text-muted-foreground">{t("admin.loading")}</p>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
