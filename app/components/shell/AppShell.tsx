// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Image from "next/image";
import Link from "next/link";
import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useT } from "@/app/i18n/LocaleProvider";
import {
  clearSession,
  fetchMe,
  getAccessToken,
  type MeResponse,
} from "@/app/lib/session";
import { Button } from "@/app/components/ui/button";
import { AppNav } from "./AppNav";
import { MobileDrawer } from "./MobileDrawer";
import { UserMenu } from "./UserMenu";

function redirectToLogin(pathname: string, search: string): void {
  const next = `${pathname}${search}`;
  const qs = next && next !== "/login" ? `?next=${encodeURIComponent(next)}` : "";
  window.location.replace(`/login${qs}`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isLoginPassthrough = pathname === "/admin/login";

  useEffect(() => {
    if (isLoginPassthrough) return;

    let cancelled = false;
    void (async () => {
      const token = getAccessToken();
      if (!token) {
        await Promise.resolve();
        if (!cancelled) redirectToLogin(pathname, window.location.search);
        return;
      }
      const next = await fetchMe();
      if (cancelled) return;
      if (!next) {
        clearSession();
        redirectToLogin(pathname, window.location.search);
        return;
      }
      setMe(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoginPassthrough, pathname]);

  if (isLoginPassthrough) {
    return <>{children}</>;
  }

  if (loading || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        {t("shell.redirectLogin")}
      </div>
    );
  }

  const roles = me.roles;

  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="md:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label={t("nav.menu")}
            >
              <Menu className="h-4 w-4" />
            </Button>
            <Link href="/admin" className="flex items-center gap-2">
              <Image
                src="/assets/Nexora.png"
                alt={t("brand.name")}
                width={32}
                height={32}
                className="h-8 w-8"
                priority
              />
              <span className="font-semibold tracking-tight">
                {t("shell.adminTitle")}
              </span>
            </Link>
          </div>
          <UserMenu userId={me.userId} roles={roles} />
        </div>
        <nav className="mx-auto hidden max-w-6xl px-4 pb-3 md:block" aria-label="Admin">
          <AppNav roles={roles} />
        </nav>
      </header>

      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        roles={roles}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
