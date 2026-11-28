// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/app/components/ui/popover";
import { cn } from "@/app/lib/cn";

export type ComboboxOption = {
  value: string;
  label: string;
  /** Extra text matched by the search box (e.g. category code). */
  keywords?: string;
};

export type ComboboxProps = {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  /** Sentinel shown as first option for “all / none”. Empty string maps here. */
  emptyValue?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

function matchesQuery(option: ComboboxOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${option.label} ${option.keywords ?? ""} ${option.value}`.toLowerCase();
  return hay.includes(q);
}

/** Searchable single-select: type to filter options, click to choose. */
export function Combobox({
  id,
  value = "",
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyLabel,
  emptyValue = "__all",
  disabled,
  className,
  "aria-label": ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const triggerLabel =
    value === ""
      ? emptyLabel ?? placeholder
      : selected?.label ?? placeholder;

  const filtered = React.useMemo(
    () => options.filter((o) => matchesQuery(o, query)),
    [options, query],
  );

  React.useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const pick = (next: string) => {
    onChange?.(next);
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-between gap-2 px-3 font-normal",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 pl-8"
            aria-label={searchPlaceholder}
          />
        </div>
        <ul
          className="max-h-56 overflow-y-auto"
          role="listbox"
          aria-label={ariaLabel ?? placeholder}
        >
          {emptyLabel ? (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={value === ""}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                  value === "" && "bg-muted font-medium",
                )}
                onClick={() => pick("")}
              >
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0",
                    value === "" ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="truncate text-muted-foreground">{emptyLabel}</span>
              </button>
            </li>
          ) : null}
          {filtered.length === 0 ? (
            <li className="px-2 py-3 text-center text-sm text-muted-foreground">—</li>
          ) : (
            filtered.map((option) => {
              const active = option.value === value;
              return (
                <li key={option.value || emptyValue}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                      active && "bg-muted font-medium",
                    )}
                    onClick={() => pick(option.value)}
                  >
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0",
                        active ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.keywords ? (
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {option.keywords}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
