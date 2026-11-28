// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { MEMBERSHIP_ROLES, type MembershipRole } from "@/contexts/system/domain/types";
import { useT } from "@/app/i18n/LocaleProvider";
import { cn } from "@/app/lib/cn";
import { roleLabel } from "./types";

type Props = {
  value: MembershipRole[];
  onChange: (next: MembershipRole[]) => void;
  disabled?: boolean;
};

export function RoleChecklist({ value, onChange, disabled }: Props) {
  const t = useT();
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {MEMBERSHIP_ROLES.map((role) => {
        const checked = value.includes(role);
        return (
          <label
            key={role}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs",
              checked ? "bg-accent/40" : "bg-card",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={checked}
              disabled={disabled}
              onChange={() => {
                if (checked) onChange(value.filter((r) => r !== role));
                else onChange([...value, role]);
              }}
            />
            <span>{roleLabel(t, role)}</span>
          </label>
        );
      })}
    </div>
  );
}
