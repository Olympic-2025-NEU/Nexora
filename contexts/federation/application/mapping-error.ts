// SPDX-License-Identifier: AGPL-3.0-only
export class MappingError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
