// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma } from "@prisma/client";
import type { Actor } from "../identity/actor";
import type { PartnerActor } from "../identity/partner-actor";
import { requirePolicy } from "../access/policy";

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

type CommandActor = Actor | PartnerActor;
type LaterSteps = { [Step in "idempotency" | "domain" | "commit"]: (ctx: CommandContext) => Promise<void> };

export type CommandOptions = LaterSteps & {
  authenticate(): Promise<CommandActor>;
  /** Read the organization from trusted DB state, never from request headers. */
  resolveTenant(actor: CommandActor): Promise<string>;
  action: string;
};

/** Run each named step once, in registry order; reject replacement of trusted context. */
export async function runCommand(ctx: CommandContext, options: CommandOptions): Promise<void> {
  if (ctx.actor !== undefined || ctx.tx !== undefined || ctx.tenantId !== undefined) {
    throw new Error("Command context must start without trusted identity or transaction");
  }
  const handlers: { [Step in CommandStep]: (ctx: CommandContext) => Promise<void> } = {
    async authenticate(current) {
      current.actor = await options.authenticate();
      if (!current.actor) throw new Error("Authentication returned no actor");
    },
    async "resolve-tenant"(current) {
      const actor = current.actor!;
      current.tenantId = await options.resolveTenant(actor);
      if (!current.tenantId || ("organizationId" in actor && actor.organizationId !== current.tenantId)) {
        throw new Error("Actor organization does not match resolved tenant");
      }
    },
    async authorize(current) {
      const actor = current.actor!;
      const policyActor: Actor = "organizationId" in actor ? actor : {
        userId: actor.clientId, organizationId: current.tenantId!, unitIds: [], roles: ["partner"],
      };
      requirePolicy(policyActor, options.action);
    },
    idempotency: options.idempotency,
    domain: options.domain,
    commit: options.commit,
  };
  let actor: CommandActor | undefined;
  let tx: Prisma.TransactionClient | undefined;
  let tenantId: string | undefined;
  for (const step of commandPipeline) {
    await handlers[step](ctx);
    if ((actor !== undefined && ctx.actor !== actor) || (tx !== undefined && ctx.tx !== tx) ||
        (tenantId !== undefined && ctx.tenantId !== tenantId)) {
      throw new Error(`Command context replaced during ${step}`);
    }
    actor = ctx.actor;
    tx = ctx.tx;
    tenantId = ctx.tenantId;
  }
}
