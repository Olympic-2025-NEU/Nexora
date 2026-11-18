// SPDX-License-Identifier: AGPL-3.0-only
import type { OrganizationId } from "../kernel/id";

/** Written in the same transaction as the business change. Dispatched after commit. */
export type OutboxMessage<TPayload = unknown> = {
  organizationId: OrganizationId;
  type: string;
  payload: TPayload;
};

export type Outbox = {
  enqueue(message: OutboxMessage): Promise<void>;
};
