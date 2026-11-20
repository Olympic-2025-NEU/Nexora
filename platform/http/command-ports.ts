// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma } from "@prisma/client";

export type IdempotencyScope = {
  key: string;
  actorOrClient: string;
  method: string;
  routeKey: string;
  payloadSha256: string;
};

export type LookupOutcome = { kind: "fresh" } | { kind: "replay"; result: unknown };

/** Concurrent transaction owns the unique key; recheck after its transaction resolves. */
export class IdempotencyClaimLostError extends Error {}

export interface IdempotencyPort {
  lookup(scope: IdempotencyScope): Promise<LookupOutcome>;
  claim(tx: Prisma.TransactionClient, scope: IdempotencyScope): Promise<{ recordId: string }>;
  complete(tx: Prisma.TransactionClient, recordId: string, result: unknown): Promise<void>;
  purgeExpired(now?: Date): Promise<number>;
}

/** T03 owns post-commit delivery. Delivery failure cannot roll back committed work. */
export interface DispatchPort {
  dispatch(requestId: string): Promise<void>;
}

export class UnimplementedIdempotency implements IdempotencyPort {
  async lookup(_scope: IdempotencyScope): Promise<never> { throw new Error("IdempotencyPort is not implemented (P04-T02)"); }
  async claim(): Promise<never> { throw new Error("IdempotencyPort is not implemented (P04-T02)"); }
  async complete(): Promise<never> { throw new Error("IdempotencyPort is not implemented (P04-T02)"); }
  async purgeExpired(): Promise<never> { throw new Error("IdempotencyPort is not implemented (P04-T02)"); }
}

export class UnimplementedDispatch implements DispatchPort {
  async dispatch(): Promise<never> { throw new Error("DispatchPort is not implemented (P04-T03)"); }
}
