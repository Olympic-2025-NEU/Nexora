// SPDX-License-Identifier: AGPL-3.0-only
/** T02 owns persistence and replay semantics; never simulate successful reservation here. */
export interface IdempotencyPort {
  reserve(key: string, actorId: string, action: string): Promise<void>;
  complete(key: string, result: unknown): Promise<void>;
}

/** T03 owns post-commit delivery. Delivery failure cannot roll back committed work. */
export interface DispatchPort {
  dispatch(requestId: string): Promise<void>;
}

export class UnimplementedIdempotency implements IdempotencyPort {
  async reserve(): Promise<never> { throw new Error("IdempotencyPort is not implemented (P04-T02)"); }
  async complete(): Promise<never> { throw new Error("IdempotencyPort is not implemented (P04-T02)"); }
}

export class UnimplementedDispatch implements DispatchPort {
  async dispatch(): Promise<never> { throw new Error("DispatchPort is not implemented (P04-T03)"); }
}
