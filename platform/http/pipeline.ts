// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma } from "@prisma/client";
import type { Actor } from "../identity/actor";
import type { PartnerActor } from "../identity/partner-actor";

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

export type CommandContext = {
  readonly requestId: string;
  actor?: Actor | PartnerActor;
  tenantId?: string;
  tx?: Prisma.TransactionClient;
};

type StepHandlers = { [Step in CommandStep]: (ctx: CommandContext) => Promise<void> };

/** Run each named step once, in registry order; reject replacement of trusted context. */
export async function runCommand(ctx: CommandContext, handlers: StepHandlers): Promise<void> {
  let actor = ctx.actor;
  let tx = ctx.tx;
  for (const step of commandPipeline) {
    await handlers[step](ctx);
    if ((actor !== undefined && ctx.actor !== actor) || (tx !== undefined && ctx.tx !== tx)) {
      throw new Error(`Command context replaced during ${step}`);
    }
    actor = ctx.actor;
    tx = ctx.tx;
  }
}
