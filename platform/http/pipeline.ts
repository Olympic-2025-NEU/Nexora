// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma } from "@prisma/client";
import type { Actor } from "../identity/actor";
import type { PartnerActor } from "../identity/partner-actor";
import { requirePolicy } from "../access/policy";
import { transaction, type AppTransaction } from "../persistence/transaction";
import { DomainError } from "../kernel/errors";
import { IdempotencyClaimLostError, UnimplementedIdempotency, type DispatchPort, type IdempotencyPort, type IdempotencyScope } from "./command-ports";
import { hashPayload, validateIdempotencyKey } from "./idempotency";

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
  payload?: unknown;
  method?: string;
  routeKey?: string;
  idempotencyPort?: IdempotencyPort;
  dispatchPort?: DispatchPort;
  onStep?: (step: CommandStep) => void;
};

/** Run each named step once, in registry order; reject replacement of trusted context. */
export async function runCommand<T>(ctx: CommandContext, options: CommandOptions<T>): Promise<T> {
  return runCommandAttempt(ctx, options, true);
}

async function runCommandAttempt<T>(ctx: CommandContext, options: CommandOptions<T>, retryAllowed: boolean): Promise<T> {
  if (ctx.actor !== undefined || ctx.tx !== undefined || ctx.tenantId !== undefined) {
    throw new Error("Command context must start without trusted identity or transaction");
  }
  let result: T;
  let scope: IdempotencyScope | undefined;
  let replayed = false;
  const port = options.idempotencyPort ?? new UnimplementedIdempotency();
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
        if (port instanceof UnimplementedIdempotency) await port.lookup({} as IdempotencyScope);
        validateIdempotencyKey(options.idempotencyKey);
        const actor = current.actor!;
        scope = {
          key: options.idempotencyKey,
          actorOrClient: "organizationId" in actor ? actor.userId : actor.clientId,
          method: options.method ?? "POST",
          routeKey: options.routeKey ?? options.action,
          payloadSha256: hashPayload(options.payload ?? null),
        };
        const outcome = await port.lookup(scope);
        if (outcome.kind === "replay") {
          result = outcome.result as T;
          replayed = true;
        }
      }
    },
    async domain(current) {
      result = await (options.unitOfWork ?? (() => transaction))().run(async (tx) => {
        current.tx = tx;
        const actor = current.actor!;
        const tenantId = current.tenantId!;
        try {
          const claim = scope ? await port.claim(tx, scope) : undefined;
          const value = await options.domain(current as CommandContext & {
            actor: CommandActor; tenantId: string; tx: Prisma.TransactionClient;
          });
          if (current.actor !== actor || current.tenantId !== tenantId || current.tx !== tx) {
            throw new Error("Command context replaced during domain");
          }
          if (claim) await port.complete(tx, claim.recordId, value);
          return value;
        } finally {
          current.tx = undefined;
        }
      });
    },
    async commit(current) {
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
    try {
      await handlers[step](ctx);
    } catch (error) {
      if (!(error instanceof IdempotencyClaimLostError) || step !== "domain" || !scope) throw error;
      const outcome = await port.lookup(scope);
      if (outcome.kind === "replay") return outcome.result as T;
      if (retryAllowed) return runCommandAttempt({ requestId: ctx.requestId }, options, false);
      throw new DomainError("IDEMPOTENCY_IN_PROGRESS", 409);
    }
    if (replayed) return result!;
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
