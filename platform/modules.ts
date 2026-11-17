// SPDX-License-Identifier: AGPL-3.0-only
export const modules = {
  platform: [
    "identity",
    "tenancy",
    "access",
    "audit",
    "workflow",
    "files",
    "outbox",
  ],
  contexts: [
    "master-data",
    "sales",
    "procurement",
    "inventory",
    "finance",
  ],
} as const;
