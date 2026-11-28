// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import * as React from "react";
import { format, isValid, parse, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/app/components/ui/button";
import { Calendar } from "@/app/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/app/components/ui/popover";
import { cn } from "@/app/lib/cn";

const DATE_FMT = "yyyy-MM-dd";
const TIME_FMT = "HH:mm";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function parseDateValue(value?: string): Date | undefined {
  if (!value) return undefined;
  const iso = value.includes("T") ? parseISO(value) : parse(value, DATE_FMT, new Date());
  return isValid(iso) ? iso : undefined;
}

function toDateString(date: Date): string {
  return format(date, DATE_FMT);
}

function toTimeString(date: Date): string {
  return format(date, TIME_FMT);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function splitDateTime(value?: string): { date?: Date; time: string } {
  if (!value) return { time: "00:00" };
  const date = parseDateValue(value);
  if (!date) return { time: "00:00" };
  const timePart = value.includes("T") ? value.split("T")[1]?.slice(0, 5) : toTimeString(date);
  return { date, time: timePart && /^\d{2}:\d{2}$/.test(timePart) ? timePart : "00:00" };
}

function TimeColumn({
  label,
  values,
  selected,
  onSelect,
}: {
  label: string;
  values: number[];
  selected: number;
  onSelect: (value: number) => void;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const active = root.querySelector<HTMLElement>("[data-selected='true']");
    active?.scrollIntoView({ block: "center" });
  }, [selected]);

  return (
    <div className="flex min-w-[4.5rem] flex-1 flex-col gap-1.5">
      <p className="px-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div
        ref={listRef}
        role="listbox"
        aria-label={label}
        className="h-44 overflow-y-auto rounded-md border border-border bg-muted/20 p-1"
      >
        {values.map((value) => {
          const isSelected = value === selected;
          return (
            <button
              key={value}
              type="button"
              role="option"
              aria-selected={isSelected}
              data-selected={isSelected ? "true" : "false"}
              onClick={() => onSelect(value)}
              className={cn(
                "flex w-full items-center justify-center rounded-sm px-2 py-1.5 font-mono text-sm tabular-nums transition-colors",
                isSelected
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "text-foreground hover:bg-muted",
              )}
            >
              {pad2(value)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TimePicker({
  time,
  onChange,
  hourLabel = "Hour",
  minuteLabel = "Minute",
}: {
  time: string;
  onChange: (next: string) => void;
  hourLabel?: string;
  minuteLabel?: string;
}) {
  const [hh, mm] = time.split(":").map((part) => Number(part));
  const hour = Number.isFinite(hh) ? Math.min(23, Math.max(0, hh)) : 0;
  const minute = Number.isFinite(mm) ? Math.min(59, Math.max(0, mm)) : 0;

  return (
    <div className="flex gap-2" data-purpose="time-picker">
      <TimeColumn
        label={hourLabel}
        values={HOURS}
        selected={hour}
        onSelect={(nextHour) => onChange(`${pad2(nextHour)}:${pad2(minute)}`)}
      />
      <TimeColumn
        label={minuteLabel}
        values={MINUTES}
        selected={minute}
        onSelect={(nextMinute) => onChange(`${pad2(hour)}:${pad2(nextMinute)}`)}
      />
    </div>
  );
}

export type DateTimePickerProps = {
  id?: string;
  mode?: "date" | "datetime";
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  hourLabel?: string;
  minuteLabel?: string;
  /** Accessible label for the trigger when no visible label is associated. */
  "aria-label"?: string;
};

/** Single date or date+time picker. Emits `yyyy-MM-dd` or `yyyy-MM-ddTHH:mm`. */
export function DateTimePicker({
  id,
  mode = "date",
  value,
  onChange,
  placeholder = "Pick a date",
  disabled,
  className,
  hourLabel,
  minuteLabel,
  "aria-label": ariaLabel,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const { date, time } = splitDateTime(value);

  const label =
    mode === "datetime" && date
      ? `${toDateString(date)} ${time}`
      : date
        ? toDateString(date)
        : placeholder;

  const commitDate = (next: Date | undefined) => {
    if (!next) {
      onChange?.("");
      return;
    }
    if (mode === "datetime") {
      onChange?.(`${toDateString(next)}T${time}`);
    } else {
      onChange?.(toDateString(next));
      setOpen(false);
    }
  };

  const commitTime = (nextTime: string) => {
    const safe = /^\d{2}:\d{2}$/.test(nextTime) ? nextTime : "00:00";
    if (!date) {
      onChange?.(`${toDateString(new Date())}T${safe}`);
      return;
    }
    onChange?.(`${toDateString(date)}T${safe}`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            "h-9 w-full justify-start gap-2 px-3 font-normal",
            !date && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0 opacity-70" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className={cn(mode === "datetime" && "flex flex-col gap-3 sm:flex-row sm:items-start")}>
          <Calendar
            mode="single"
            selected={date}
            onSelect={commitDate}
            defaultMonth={date}
          />
          {mode === "datetime" ? (
            <div className="border-t border-border pt-3 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
              <TimePicker
                time={time}
                onChange={commitTime}
                hourLabel={hourLabel}
                minuteLabel={minuteLabel}
              />
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export type DateRangeValue = { from: string; to: string };

export type DateRangePickerProps = {
  id?: string;
  from?: string;
  to?: string;
  onChange?: (range: DateRangeValue) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

/** Date range picker. Emits `{ from, to }` as `yyyy-MM-dd` strings. */
export function DateRangePicker({
  id,
  from,
  to,
  onChange,
  placeholder = "Pick a date range",
  disabled,
  className,
  "aria-label": ariaLabel,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selected: DateRange | undefined = React.useMemo(() => {
    const fromDate = parseDateValue(from);
    const toDate = parseDateValue(to);
    if (!fromDate && !toDate) return undefined;
    return { from: fromDate, to: toDate };
  }, [from, to]);

  const label =
    from && to
      ? `${from} → ${to}`
      : from
        ? `${from} → …`
        : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            "h-9 w-full justify-start gap-2 px-3 font-normal",
            !from && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0 opacity-70" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <Calendar
          mode="range"
          numberOfMonths={2}
          selected={selected}
          onSelect={(range) => {
            onChange?.({
              from: range?.from ? toDateString(range.from) : "",
              to: range?.to ? toDateString(range.to) : "",
            });
            if (range?.from && range?.to) setOpen(false);
          }}
          defaultMonth={selected?.from}
        />
      </PopoverContent>
    </Popover>
  );
}
