// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma } from "@prisma/client";
import type { Actor } from "../identity/actor";
import type { PartnerActor } from "../identity/partner-actor";
import { requirePolicy } from "../access/policy";
import { transaction, type AppTransaction } from "../persistence/transaction";
import { UnimplementedIdempotency, type DispatchPort, type IdempotencyPort } from "./command-ports";

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

export type CommandOptions<T> = {
  authenticate(): Promise<CommandActor>;
  /** Read the organization from trusted DB state, never from request headers. */
  resolveTenant(actor: CommandActor): Promise<string>;
  action: string;
  domain(ctx: CommandContext & { actor: CommandActor; tenantId: string; tx: Prisma.TransactionClient }): Promise<T>;
  unitOfWork?: () => AppTransaction;
  idempotencyKey?: string;
  idempotencyPort?: IdempotencyPort;
  dispatchPort?: DispatchPort;
  onStep?: (step: CommandStep) => void;
};

/** Run each named step once, in registry order; reject replacement of trusted context. */
export async function runCommand<T>(ctx: CommandContext, options: CommandOptions<T>): Promise<T> {
  if (ctx.actor !== undefined || ctx.tx !== undefined || ctx.tenantId !== undefined) {
    throw new Error("Command context must start without trusted identity or transaction");
  }
  let result: T;
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
    async idempotency(current) {
      if (options.idempotencyKey !== undefined) {
        const actor = current.actor!;
        await (options.idempotencyPort ?? new UnimplementedIdempotency()).reserve(
          options.idempotencyKey, "organizationId" in actor ? actor.userId : actor.clientId, options.action,
        );
      }
    },
    async domain(current) {
      result = await (options.unitOfWork ?? (() => transaction))().run(async (tx) => {
        current.tx = tx;
        const actor = current.actor!;
        const tenantId = current.tenantId!;
        try {
          const value = await options.domain(current as CommandContext & {
            actor: CommandActor; tenantId: string; tx: Prisma.TransactionClient;
          });
          if (current.actor !== actor || current.tenantId !== tenantId || current.tx !== tx) {
            throw new Error("Command context replaced during domain");
          }
          return value;
        } finally {
          current.tx = undefined;
        }
      });
    },
    async commit(current) {
      if (options.idempotencyKey !== undefined) {
        await (options.idempotencyPort ?? new UnimplementedIdempotency()).complete(options.idempotencyKey, result);
      }
      if (options.dispatchPort) {
        try {
          await options.dispatchPort.dispatch(current.requestId);
        } catch (error) {
          // Committed work cannot roll back; T03 will retry delivery from durable outbox.
          console.error("Post-commit dispatch failed", { requestId: current.requestId, error });
        }
      }
    },
  };
  let actor: CommandActor | undefined;
  let tx: Prisma.TransactionClient | undefined;
  let tenantId: string | undefined;
  for (const step of commandPipeline) {
    options.onStep?.(step);
    await handlers[step](ctx);
    if ((actor !== undefined && ctx.actor !== actor) || (tx !== undefined && ctx.tx !== tx) ||
        (tenantId !== undefined && ctx.tenantId !== tenantId)) {
      throw new Error(`Command context replaced during ${step}`);
    }
    actor = ctx.actor;
    tx = ctx.tx;
    tenantId = ctx.tenantId;
  }
  return result!;
}
