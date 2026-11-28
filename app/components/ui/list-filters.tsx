// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Combobox, type ComboboxOption } from "@/app/components/ui/combobox";
import {
  DateRangePicker,
  DateTimePicker,
} from "@/app/components/ui/date-time-picker";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";
import { hasActiveFilters } from "@/app/lib/filter-params";

export type FilterSelectOption = ComboboxOption;

export type FilterField =
  | {
      type: "search";
      key: string;
      label: string;
      placeholder?: string;
      /** Debounce live draft→parent; Apply/Enter still commit immediately. Default 300. */
      debounceMs?: number;
    }
  | {
      type: "text";
      key: string;
      label: string;
      placeholder?: string;
    }
  | {
      type: "select";
      key: string;
      label: string;
      options: FilterSelectOption[];
      placeholder?: string;
      /** Radix Select forbids empty string values; map "" → this sentinel. Default `__all`. */
      emptyValue?: string;
    }
  | {
      type: "combobox";
      key: string;
      label: string;
      options: FilterSelectOption[];
      placeholder?: string;
      searchPlaceholder?: string;
      emptyLabel?: string;
    }
  | {
      type: "date";
      key: string;
      label: string;
      placeholder?: string;
    }
  | {
      type: "datetime";
      key: string;
      label: string;
      placeholder?: string;
    }
  | {
      type: "dateRange";
      fromKey: string;
      toKey: string;
      label: string;
      placeholder?: string;
    };

export type ListFiltersProps = {
  fields: FilterField[];
  /** Applied / committed filter values (source of truth for queries). */
  values: Record<string, string>;
  /** Called when the user applies (button / Enter on search). */
  onApply: (values: Record<string, string>) => void;
  /** Optional live draft updates (e.g. URL sync while typing is disabled by default). */
  onDraftChange?: (values: Record<string, string>) => void;
  applyLabel?: string;
  clearLabel?: string;
  className?: string;
  /** Hide Apply when every field auto-applies; still useful for search. Default false. */
  hideApply?: boolean;
  /** `sidebar` stacks fields vertically for a left filter rail. */
  layout?: "bar" | "sidebar";
  title?: string;
};

function fieldKeys(field: FilterField): string[] {
  if (field.type === "dateRange") return [field.fromKey, field.toKey];
  return [field.key];
}

function emptyValues(fields: FilterField[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const field of fields) {
    for (const key of fieldKeys(field)) next[key] = "";
  }
  return next;
}

/**
 * Reusable list filter bar: search (draft + Enter/Apply), text, select, date, datetime, date range.
 * Parents keep committed `values` and reload data when `onApply` fires.
 */
export function ListFilters({
  fields,
  values,
  onApply,
  onDraftChange,
  applyLabel = "Apply",
  clearLabel = "Clear",
  className,
  hideApply = false,
  layout = "bar",
  title,
}: ListFiltersProps) {
  const [draft, setDraft] = React.useState<Record<string, string>>(values);
  const [valuesSnapshot, setValuesSnapshot] = React.useState(values);
  const debounceTimers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // Reset local draft when the parent commits new applied values (apply/clear).
  if (values !== valuesSnapshot) {
    setValuesSnapshot(values);
    setDraft(values);
  }

  React.useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const setField = React.useCallback(
    (key: string, value: string, opts?: { debounceMs?: number; apply?: boolean }) => {
      setDraft((prev) => {
        const next = { ...prev, [key]: value };
        queueMicrotask(() => {
          onDraftChange?.(next);
          if (opts?.apply) {
            onApply(next);
            return;
          }
          if (opts?.debounceMs != null && opts.debounceMs > 0) {
            const existing = debounceTimers.current.get(key);
            if (existing) clearTimeout(existing);
            debounceTimers.current.set(
              key,
              setTimeout(() => {
                debounceTimers.current.delete(key);
                onApply(next);
              }, opts.debounceMs),
            );
          }
        });
        return next;
      });
    },
    [onApply, onDraftChange],
  );

  const apply = React.useCallback(() => {
    for (const timer of debounceTimers.current.values()) clearTimeout(timer);
    debounceTimers.current.clear();
    onApply(draft);
  }, [draft, onApply]);

  const clear = React.useCallback(() => {
    for (const timer of debounceTimers.current.values()) clearTimeout(timer);
    debounceTimers.current.clear();
    const next = emptyValues(fields);
    setDraft(next);
    onDraftChange?.(next);
    onApply(next);
  }, [fields, onApply, onDraftChange]);

  const active = hasActiveFilters(values) || hasActiveFilters(draft);
  const sidebar = layout === "sidebar";

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-3 sm:p-4",
        sidebar ? "flex h-full flex-col gap-4" : "flex flex-col gap-3",
        className,
      )}
      data-purpose="list-filters"
      data-layout={layout}
    >
      {title ? (
        <p className="text-sm font-semibold tracking-tight text-foreground">{title}</p>
      ) : null}
      <div
        className={cn(
          sidebar
            ? "flex flex-col gap-4"
            : "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end",
        )}
      >
        {fields.map((field) => {
          if (field.type === "search") {
            const id = `filter-${field.key}`;
            return (
              <div
                key={field.key}
                className={cn("grid gap-1.5", !sidebar && "min-w-[12rem] flex-1")}
              >
                <Label htmlFor={id}>{field.label}</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id={id}
                    value={draft[field.key] ?? ""}
                    placeholder={field.placeholder}
                    className="pl-8"
                    onChange={(e) =>
                      setField(field.key, e.target.value, {
                        debounceMs: field.debounceMs,
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        apply();
                      }
                    }}
                  />
                </div>
              </div>
            );
          }

          if (field.type === "text") {
            const id = `filter-${field.key}`;
            return (
              <div
                key={field.key}
                className={cn("grid gap-1.5", !sidebar && "min-w-[10rem]")}
              >
                <Label htmlFor={id}>{field.label}</Label>
                <Input
                  id={id}
                  value={draft[field.key] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(e) => setField(field.key, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      apply();
                    }
                  }}
                />
              </div>
            );
          }

          if (field.type === "select") {
            const emptyValue = field.emptyValue ?? "__all";
            const current = draft[field.key] ?? "";
            return (
              <div
                key={field.key}
                className={cn("grid gap-1.5", !sidebar && "min-w-[10rem]")}
              >
                <Label htmlFor={`filter-${field.key}`}>{field.label}</Label>
                <Select
                  value={current === "" ? emptyValue : current}
                  onValueChange={(v) =>
                    setField(field.key, v === emptyValue ? "" : v)
                  }
                >
                  <SelectTrigger id={`filter-${field.key}`} className="w-full min-w-0">
                    <SelectValue placeholder={field.placeholder} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={emptyValue}>
                      {field.placeholder ?? "All"}
                    </SelectItem>
                    {field.options
                      .filter((opt) => opt.value !== "")
                      .map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            );
          }

          if (field.type === "combobox") {
            const id = `filter-${field.key}`;
            return (
              <div key={field.key} className="grid gap-1.5">
                <Label htmlFor={id}>{field.label}</Label>
                <Combobox
                  id={id}
                  value={draft[field.key] ?? ""}
                  options={field.options}
                  placeholder={field.placeholder}
                  searchPlaceholder={field.searchPlaceholder}
                  emptyLabel={field.emptyLabel ?? field.placeholder}
                  onChange={(v) => setField(field.key, v)}
                />
              </div>
            );
          }

          if (field.type === "date" || field.type === "datetime") {
            const id = `filter-${field.key}`;
            return (
              <div
                key={field.key}
                className={cn("grid gap-1.5", !sidebar && "min-w-[10rem]")}
              >
                <Label htmlFor={id}>{field.label}</Label>
                <DateTimePicker
                  id={id}
                  mode={field.type === "datetime" ? "datetime" : "date"}
                  value={draft[field.key] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(v) => setField(field.key, v)}
                />
              </div>
            );
          }

          const id = `filter-${field.fromKey}-${field.toKey}`;
          return (
            <div
              key={`${field.fromKey}-${field.toKey}`}
              className={cn("grid gap-1.5", !sidebar && "min-w-[14rem] flex-1")}
            >
              <Label htmlFor={id}>{field.label}</Label>
              <DateRangePicker
                id={id}
                from={draft[field.fromKey] ?? ""}
                to={draft[field.toKey] ?? ""}
                placeholder={field.placeholder}
                onChange={(range) => {
                  setDraft((prev) => {
                    const next = {
                      ...prev,
                      [field.fromKey]: range.from,
                      [field.toKey]: range.to,
                    };
                    onDraftChange?.(next);
                    return next;
                  });
                }}
              />
            </div>
          );
        })}

        <div
          className={cn(
            "flex flex-wrap items-center gap-2",
            sidebar ? "pt-1" : "sm:pb-0.5",
          )}
        >
          {!hideApply ? (
            <Button type="button" className={sidebar ? "w-full" : undefined} onClick={apply}>
              {applyLabel}
            </Button>
          ) : null}
          {active ? (
            <Button
              type="button"
              variant="ghost"
              className={sidebar ? "w-full" : undefined}
              onClick={clear}
            >
              <X className="h-4 w-4" />
              {clearLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
