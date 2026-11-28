// SPDX-License-Identifier: AGPL-3.0-only
export const DEFAULT_NEXT = "/dxlab/work";

export function safeNext(value: string | null | undefined): string {
  if (!value || value.length > 512 || /[\\\x00-\x1f#]/.test(value) ||
      !value.startsWith("/dxlab") || value.startsWith("//") || /%5c/i.test(value)) return DEFAULT_NEXT;
  try {
    const url = new URL(value, "https://dxlab.invalid");
    if (url.origin !== "https://dxlab.invalid" ||
        (url.pathname !== "/dxlab" && !url.pathname.startsWith("/dxlab/")) ||
        url.pathname.split("/").includes("..")) return DEFAULT_NEXT;
    return `${url.pathname}${url.search}`;
  } catch { return DEFAULT_NEXT; }
}

export function signInPath(next: string, reason?: "expired" | "required") {
  const params = new URLSearchParams({ next: safeNext(next) });
  if (reason) params.set("reason", reason);
  return `/dxlab/sign-in?${params}`;
}
