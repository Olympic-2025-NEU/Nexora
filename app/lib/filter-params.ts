// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Build URLSearchParams from filter values.
 * Empty strings are omitted by default so APIs stay clean.
 */
export function filtersToSearchParams(
  values: Record<string, string>,
  options?: { omitEmpty?: boolean },
): URLSearchParams {
  const omitEmpty = options?.omitEmpty !== false;
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(values)) {
    const value = raw?.trim() ?? "";
    if (omitEmpty && !value) continue;
    params.set(key, value);
  }
  return params;
}

/** True when any filter value is non-empty after trim. */
export function hasActiveFilters(values: Record<string, string>): boolean {
  return Object.values(values).some((v) => (v?.trim() ?? "") !== "");
}
