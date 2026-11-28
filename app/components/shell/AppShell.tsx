// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useT } from "@/app/i18n/LocaleProvider";
import {
  clearSession,
  fetchMe,
  getAccessToken,
  getCachedMe,
  type MeResponse,
} from "@/app/lib/session";
import {
  AppSidebar,
  readSidebarPinned,
  writeSidebarPinned,
} from "./AppSidebar";
import { MobileDrawer } from "./MobileDrawer";
import { SystemHeader } from "./SystemHeader";
import { APP_NAV, filterNavByRoles } from "./nav-config";

function redirectToLogin(pathname: string, search: string): void {
  const next = `${pathname}${search}`;
  const qs = next && next !== "/login" ? `?next=${encodeURIComponent(next)}` : "";
  window.location.replace(`/login${qs}`);
}

/** One shared ERP shell; system admin is reached via user menu / settings flyout. */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const [me, setMe] = useState<MeResponse | null>(() => getCachedMe());
  const [loading, setLoading] = useState(() => !getCachedMe());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pinned, setPinned] = useState(false);

  const isLoginPassthrough = pathname === "/admin/login";

  useEffect(() => {
    setPinned(readSidebarPinned());
  }, []);

  // Load / refresh session once per shell mount (cached across section remounts).
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
      const cached = getCachedMe();
      if (cached) {
        setMe(cached);
        setLoading(false);
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
    // Intentionally omit pathname — avoid /me on every soft navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / login-gate only
  }, [isLoginPassthrough]);

  // Soft navigations: only ensure the token is still present.
  useEffect(() => {
    if (isLoginPassthrough) return;
    if (!getAccessToken()) {
      redirectToLogin(pathname, window.location.search);
    }
  }, [isLoginPassthrough, pathname]);

  const navGroups = useMemo(
    () => (me ? filterNavByRoles(APP_NAV, me.roles) : []),
    [me],
  );

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
  const collapsed = !pinned;

  return (
    <div className="flex min-h-full bg-background text-foreground" data-purpose="app-body-container">
      <div className="sticky top-0 z-40 hidden h-screen md:flex">
        <AppSidebar
          groups={navGroups}
          collapsed={collapsed}
          pinned={pinned}
          hoverFlyout
          onPinnedChange={(next) => {
            setPinned(next);
            writeSidebarPinned(next);
          }}
        />
      </div>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <SystemHeader
          userId={me.userId}
          displayName={me.displayName}
          roles={roles}
          onOpenMobileNav={() => setDrawerOpen(true)}
        />

        <MobileDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          groups={navGroups}
          roles={roles}
        />

        <main
          className="w-full flex-1 px-4 py-6 lg:px-6"
          data-purpose="workspace-content"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
