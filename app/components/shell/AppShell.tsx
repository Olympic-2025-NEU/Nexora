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
import { APP_NAV, filterNavByRoles } from "./nav-config";

function redirectToLogin(pathname: string, search: string): void {
  const next = `${pathname}${search}`;
  const qs = next && next !== "/login" ? `?next=${encodeURIComponent(next)}` : "";
  window.location.replace(`/login${qs}`);
}

/** One shared ERP shell; system admin is reached via user menu. */
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

  // Always keep `{children}` in the tree so Instant Navigation can validate
  // page segments (Next.js drops validation when a Client shell omits children).
  if (loading || !me) {
    return (
      <div className="flex min-h-full flex-col bg-background text-foreground">
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          {t("shell.redirectLogin")}
        </div>
        <div className="hidden" aria-hidden>
          {children}
        </div>
      </div>
    );
  }

  const roles = me.roles;
  const navItems = filterNavByRoles(APP_NAV, roles);

  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex w-full items-center justify-between gap-3 px-4 py-3 lg:px-6">
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
            <Link href="/catalog/products" className="flex items-center gap-2">
              <Image
                src="/assets/Nexora.png"
                alt={t("brand.name")}
                width={32}
                height={32}
                className="h-8 w-8"
                priority
              />
              <span className="font-semibold tracking-tight">{t("shell.appTitle")}</span>
            </Link>
          </div>
          <UserMenu
            userId={me.userId}
            displayName={me.displayName}
            roles={roles}
          />
        </div>
        <nav className="mx-auto hidden w-full px-4 pb-3 md:block lg:px-6" aria-label={t("shell.appTitle")}>
          <AppNav items={navItems} />
        </nav>
      </header>

      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        items={navItems}
        roles={roles}
      />

      <main className="mx-auto w-full flex-1 px-4 py-6 lg:px-6">{children}</main>
    </div>
  );
}
