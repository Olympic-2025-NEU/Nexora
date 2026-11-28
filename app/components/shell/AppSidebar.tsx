// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Image from "next/image";
import Link from "next/link";
import {
  BarChart3,
  Bot,
  ChevronRight,
  LayoutDashboard,
  Package,
  Pin,
  Settings,
  ShoppingCart,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/app/i18n/LocaleProvider";
import { cn } from "@/app/lib/cn";
import { Button } from "@/app/components/ui/button";
import { NavFlyout } from "./NavFlyout";
import {
  groupIsActive,
  type NavGroup,
  type NavIcon,
} from "./nav-config";

const SIDEBAR_PINNED_KEY = "nexora.sidebarPinned";

const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  products: Package,
  warehouse: Warehouse,
  orders: ShoppingCart,
  reports: BarChart3,
  assistant: Bot,
  settings: Settings,
};

export function AppSidebar({
  groups,
  collapsed,
  pinned,
  onPinnedChange,
  onNavigate,
  className,
  /** Desktop: hover opens floating panel. Mobile drawer: tap opens panel. */
  hoverFlyout = true,
}: {
  groups: NavGroup[];
  collapsed?: boolean;
  pinned?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
  onNavigate?: () => void;
  className?: string;
  hoverFlyout?: boolean;
}) {
  const t = useT();
  const pathname = usePathname();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [panelTop, setPanelTop] = useState(0);
  const [panelLeft, setPanelLeft] = useState(0);
  const [pathSnapshot, setPathSnapshot] = useState(pathname);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map());
  const canPortal = typeof document !== "undefined";
  const isCollapsed = Boolean(collapsed);

  if (pathname !== pathSnapshot) {
    setPathSnapshot(pathname);
    setHoverId(null);
  }

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setHoverId(null), 120);
  }, [clearCloseTimer]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  function openFlyout(group: NavGroup) {
    if (!group.children?.length) return;
    clearCloseTimer();
    const el = itemRefs.current.get(group.id);
    if (el) {
      const rect = el.getBoundingClientRect();
      const panelHeight = Math.min(448, window.innerHeight - 24);
      const top = Math.min(
        Math.max(12, rect.top),
        Math.max(12, window.innerHeight - panelHeight - 12),
      );
      setPanelTop(top);
      setPanelLeft(rect.right + 14);
    }
    setHoverId(group.id);
  }

  const openGroup = groups.find((g) => g.id === hoverId && g.children?.length) ?? null;
  const showPin = Boolean(onPinnedChange);

  return (
    <aside
      className={cn(
        "relative flex h-full shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200",
        isCollapsed ? "w-[4.25rem]" : "w-64",
        className,
      )}
      data-purpose="app-menu-sidebar"
      data-collapsed={isCollapsed ? "true" : "false"}
      data-pinned={pinned ? "true" : "false"}
    >
      <div
        className={cn(
          "flex h-16 items-center border-b border-border",
          isCollapsed ? "justify-center px-2" : "gap-2.5 px-4",
        )}
      >
        <Image
          src="/assets/Nexora.png"
          alt={t("brand.name")}
          width={32}
          height={32}
          className="h-8 w-8 shrink-0"
          priority
        />
        {!isCollapsed ? (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold tracking-tight">{t("brand.name")}</p>
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("shell.erpOperations")}
            </p>
          </div>
        ) : null}
      </div>

      <div className={cn("flex-1 overflow-y-auto py-4", isCollapsed ? "px-1.5" : "px-2.5")}>
        {!isCollapsed ? (
          <div className="mb-2 flex items-center justify-between gap-2 px-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("nav.mainNav")}
            </p>
            {showPin ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                aria-pressed={Boolean(pinned)}
                aria-label={pinned ? t("shell.unpinNav") : t("shell.pinNav")}
                title={pinned ? t("shell.unpinNav") : t("shell.pinNav")}
                onClick={() => onPinnedChange?.(!pinned)}
              >
                <Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} />
              </Button>
            ) : null}
          </div>
        ) : showPin ? (
          <div className="mb-2 flex justify-center">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-pressed={Boolean(pinned)}
              aria-label={pinned ? t("shell.unpinNav") : t("shell.pinNav")}
              title={pinned ? t("shell.unpinNav") : t("shell.pinNav")}
              onClick={() => onPinnedChange?.(!pinned)}
            >
              <Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} />
            </Button>
          </div>
        ) : null}
        <nav className="space-y-1" aria-label={t("nav.mainNav")}>
          {groups.map((group) => {
            const hasChildren = Boolean(group.children?.length);
            const pathActive = groupIsActive(pathname, group);
            const flyoutOpen = hoverId === group.id;
            const active = pathActive || flyoutOpen;
            const Icon = NAV_ICONS[group.icon];
            const usesFlyout = hasChildren;

            const itemClass = cn(
              "flex w-full items-center rounded-lg text-sm transition-colors",
              isCollapsed ? "justify-center px-2 py-2.5" : "justify-between gap-2 px-3 py-2",
              active
                ? "bg-primary font-semibold text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            );

            const label = (
              <>
                <span className={cn("flex min-w-0 items-center", isCollapsed ? "" : "gap-2")}>
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {!isCollapsed ? <span className="truncate">{t(group.labelKey)}</span> : null}
                </span>
                {!isCollapsed && hasChildren ? (
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 shrink-0",
                      active ? "text-primary-foreground/80" : "text-muted-foreground",
                    )}
                  />
                ) : null}
              </>
            );

            const bindRef = (node: HTMLElement | null) => {
              if (node) itemRefs.current.set(group.id, node);
              else itemRefs.current.delete(group.id);
            };

            if (!usesFlyout && group.href) {
              return (
                <Link
                  key={group.id}
                  ref={bindRef}
                  href={group.href}
                  title={isCollapsed ? t(group.labelKey) : undefined}
                  onClick={() => {
                    setHoverId(null);
                    onNavigate?.();
                  }}
                  onMouseEnter={() => {
                    if (hoverFlyout) {
                      clearCloseTimer();
                      setHoverId(null);
                    }
                  }}
                  className={itemClass}
                >
                  {label}
                </Link>
              );
            }

            return (
              <button
                key={group.id}
                ref={bindRef}
                type="button"
                title={isCollapsed ? t(group.labelKey) : undefined}
                className={itemClass}
                aria-expanded={flyoutOpen}
                aria-haspopup="true"
                onMouseEnter={() => {
                  if (hoverFlyout) openFlyout(group);
                }}
                onMouseLeave={() => {
                  if (hoverFlyout) scheduleClose();
                }}
                onFocus={() => openFlyout(group)}
                onClick={() => {
                  if (!hoverFlyout) {
                    if (flyoutOpen) setHoverId(null);
                    else openFlyout(group);
                  }
                }}
              >
                {label}
              </button>
            );
          })}
        </nav>
      </div>

      {canPortal && openGroup
        ? createPortal(
            <NavFlyout
              group={openGroup}
              onNavigate={() => {
                setHoverId(null);
                onNavigate?.();
              }}
              className="fixed z-[60]"
              style={{ top: panelTop, left: panelLeft }}
              onMouseEnter={clearCloseTimer}
              onMouseLeave={() => {
                if (hoverFlyout) scheduleClose();
                else setHoverId(null);
              }}
            />,
            document.body,
          )
        : null}
    </aside>
  );
}

export function readSidebarPinned(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_PINNED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarPinned(pinned: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_PINNED_KEY, pinned ? "1" : "0");
  } catch {
    /* ignore */
  }
}
