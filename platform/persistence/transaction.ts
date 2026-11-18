// SPDX-License-Identifier: AGPL-3.0-only
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";

/** Every repository in a command receives this same TransactionClient. */
export type AppTransaction = {
  run<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
};

export type TransactionSettings = {
  maxWaitMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
};

export class TransactionConflictError extends Error {
  readonly code = "TRANSACTION_CONFLICT";
  constructor(cause: unknown) {
    super("Transaction conflicted after bounded retries", { cause });
    this.name = "TransactionConflictError";
  }
}

export class TransactionTimeoutError extends Error {
  readonly code = "TRANSACTION_TIMEOUT";
  constructor(cause: unknown) {
    super("Transaction exceeded its time limit", { cause });
    this.name = "TransactionTimeoutError";
  }
}

function errorCodes(error: unknown): Set<string> {
  const codes = new Set<string>();
  const visited = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    if (visited.has(current)) break;
    visited.add(current);
    const candidate = current as { code?: unknown; meta?: { code?: unknown }; cause?: unknown };
    if (typeof candidate.code === "string") codes.add(candidate.code);
    if (typeof candidate.meta?.code === "string") codes.add(candidate.meta.code);
    current = candidate.cause;
  }
  return codes;
}

export function isRetryableTransactionError(error: unknown): boolean {
  const codes = errorCodes(error);
  return ["P2034", "40001", "40P01"].some((code) => codes.has(code));
}

function isTimeout(error: unknown): boolean {
  const codes = errorCodes(error);
  return codes.has("P1008") ||
    (codes.has("P2028") && error instanceof Error && /expired|timed?\s*out|timeout/i.test(error.message));
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

/**
 * The callback must contain database work only: it may run again after a
 * serialization/deadlock abort. Network calls and file writes belong after commit.
 */
export function createTransaction(client: PrismaClient, settings: TransactionSettings = {}): AppTransaction {
  const maxWaitMs = positiveInteger(settings.maxWaitMs ?? 2_000, "maxWaitMs");
  const timeoutMs = positiveInteger(settings.timeoutMs ?? 10_000, "timeoutMs");
  const maxRetries = settings.maxRetries ?? 2;
  const retryDelayMs = settings.retryDelayMs ?? 20;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3) {
    throw new Error("maxRetries must be between 0 and 3");
  }
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 1_000) {
    throw new Error("retryDelayMs must be between 0 and 1000");
  }

  return {
    async run<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
      for (let attempt = 0; ; attempt++) {
        try {
          return await client.$transaction((tx) => work(tx), {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: maxWaitMs,
            timeout: timeoutMs,
          });
        } catch (error) {
          if (isRetryableTransactionError(error)) {
            if (attempt === maxRetries) throw new TransactionConflictError(error);
            const delay = retryDelayMs * (attempt + 1);
            if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          if (isTimeout(error)) throw new TransactionTimeoutError(error);
          throw error;
        }
      }
    },
  };
}

/** Stable order for multi-row locks; pass a canonical composite resource key. */
export function orderForLocking<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((left, right) => {
    const a = key(left);
    const b = key(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export const transaction: AppTransaction = createTransaction(prisma);

/** @deprecated Prefer AppTransaction + TransactionClient (D03). */
export type Transaction = {
  run<T>(work: () => Promise<T>): Promise<T>;
};
