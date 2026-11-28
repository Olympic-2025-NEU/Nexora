// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { adminApi } from "@/app/lib/admin-api";
import { cn } from "@/app/lib/cn";

const previewCache = new Map<string, string>();

type ProductThumbProps = {
  attachmentId?: string | null;
  alt?: string;
  className?: string;
};

/** Mini product thumbnail loaded via authenticated file download. */
export function ProductThumb({ attachmentId, alt = "", className }: ProductThumbProps) {
  const cached = attachmentId ? previewCache.get(attachmentId) ?? null : null;
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Drop stale loaded blob when the row's attachment changes.
  if (attachmentId !== loadedFor && loadedSrc !== null) {
    setLoadedSrc(null);
    setLoadedFor(attachmentId ?? null);
  }

  const src = cached ?? (attachmentId && loadedFor === attachmentId ? loadedSrc : null);

  useEffect(() => {
    if (!attachmentId) return;
    if (previewCache.has(attachmentId)) return;

    let cancelled = false;
    void (async () => {
      const res = await adminApi(`/api/v1/files/${attachmentId}?download=1`);
      if (!res.ok || cancelled) return;
      const blob = await res.blob();
      if (cancelled) return;
      const objectUrl = URL.createObjectURL(blob);
      previewCache.set(attachmentId, objectUrl);
      setLoadedFor(attachmentId);
      setLoadedSrc(objectUrl);
    })();

    return () => {
      cancelled = true;
    };
  }, [attachmentId]);

  return (
    <span
      className={cn(
        "inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40",
        className,
      )}
      aria-hidden={src ? undefined : true}
    >
      {src ? (
        // Blob URLs from auth download are not static public assets.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <ImageIcon className="h-4 w-4 text-muted-foreground" />
      )}
    </span>
  );
}
