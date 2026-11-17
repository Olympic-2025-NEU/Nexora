// SPDX-License-Identifier: AGPL-3.0-only
/** Thứ tự bắt buộc của một lệnh ghi. Route handler không được đảo các bước. */
export const commandPipeline = [
  "authenticate",
  "resolve-tenant",
  "authorize",
  "idempotency",
  "domain",
  "commit",
] as const;

export type CommandStep = (typeof commandPipeline)[number];
