// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * One use-case write path: aggregate + history + outbox share this callback's client.
 * Repositories must receive `tx` — do not call the singleton inside an open TX.
 */
export type AppTransaction = {
  run<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
};

export const transaction: AppTransaction = {
  run(work) {
    return prisma.$transaction((tx) => work(tx));
  },
};

/** @deprecated Prefer AppTransaction + TransactionClient (D03). */
export type Transaction = {
  run<T>(work: () => Promise<T>): Promise<T>;
};
