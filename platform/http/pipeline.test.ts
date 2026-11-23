// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { it } from "node:test";
import type { Prisma } from "@prisma/client";
import { DomainError } from "../kernel/errors";
import { TokenError } from "../identity/token";
import { resolveCommandTenant } from "../tenancy/resolve-command-tenant";
import type { AppTransaction } from "../persistence/transaction";
import { IdempotencyClaimLostError, UnimplementedIdempotency, type IdempotencyPort } from "./command-ports";
import { mapCommandError } from "./error-mapping";
import { commandPipeline, runCommand, type CommandContext, type CommandOptions } from "./pipeline";

const actor = { userId: "user-1", organizationId: "org-1", unitIds: [], roles: ["staff"] };
const written: unknown[] = [];
const tx = { outboxMessage: { createMany: async ({ data }: { data: unknown[] }) => { written.push(...data); } } } as unknown as Prisma.TransactionClient;

function fakePort(overrides: Partial<IdempotencyPort>): IdempotencyPort {
  const unused = async (): Promise<never> => { throw new Error("unexpected port call"); };
  return { lookup: unused, claim: unused, complete: unused, purgeExpired: unused, ...overrides };
}

function setup() {
  const order: string[] = [];
  let factoryCalls = 0;
  let runs = 0;
  const unitOfWork = () => {
    factoryCalls++;
    return { async run<T>(work: (value: Prisma.TransactionClient) => Promise<T>): Promise<T> {
      runs++;
      order.push("transaction-open");
      const value = await work(tx);
      order.push("transaction-committed");
      return value;
    } } satisfies AppTransaction;
  };
  const ctx: CommandContext = { requestId: "correlation-1" };
  const options: CommandOptions<string> = {
    authenticate: async () => actor,
    resolveTenant: async () => "org-1",
    action: "trading:goods-issue:create",
    unitOfWork,
    onStep: (step) => order.push(step),
    domain: async (current) => {
      assert.equal(current.tx, tx);
      assert.equal(current.actor, actor);
      assert.equal(current.requestId, "correlation-1");
      order.push("audit-in-transaction");
      return "ok";
    },
  };
  return { ctx, options, order, factoryCalls: () => factoryCalls, runs: () => runs };
}

it("runs registry order; domain receives transaction and audit correlation before commit", async () => {
  const { ctx, options, order, factoryCalls, runs } = setup();
  assert.equal(await runCommand(ctx, options), "ok");
  assert.deepEqual(order, [
    ...commandPipeline.slice(0, 5), "transaction-open", "audit-in-transaction",
    "transaction-committed", "commit",
  ]);
  assert.equal(factoryCalls(), 1);
  assert.equal(runs(), 1);
  assert.equal(ctx.tx, undefined);
});

it("authentication and authorization failures short-circuit before UoW factory", async () => {
  const invalid = setup();
  invalid.options.authenticate = async () => { throw new TokenError("MISSING_BEARER", "Missing", 401); };
  await assert.rejects(runCommand(invalid.ctx, invalid.options), TokenError);
  assert.deepEqual(invalid.order, ["authenticate"]);
  assert.equal(invalid.factoryCalls(), 0); // Spy on factory itself, not only DB work.

  const forbidden = setup();
  forbidden.options.action = "admin:partner:manage";
  await assert.rejects(runCommand(forbidden.ctx, forbidden.options), { name: "PolicyError" });
  assert.deepEqual(forbidden.order, ["authenticate", "resolve-tenant", "authorize"]);
  assert.equal(forbidden.factoryCalls(), 0);
});

it("denies cross-tenant membership before transaction, even when client header claims matching tenant", async () => {
  const sample = setup();
  const headers = new Headers({ "x-tenant-id": "org-1" });
  sample.options.resolveTenant = (identity) => resolveCommandTenant(identity, {
    findMembershipOrganization: async () => "org-2",
    findOrganization: async () => ({ id: "org-2", status: "active" }),
    findLocalOrganization: async () => { throw new Error("not a partner"); },
  });
  assert.equal(headers.get("x-tenant-id"), "org-1");
  await assert.rejects(runCommand(sample.ctx, sample.options), { code: "TENANT_FORBIDDEN" });
  assert.equal(sample.factoryCalls(), 0);
  assert.deepEqual(sample.order, ["authenticate", "resolve-tenant"]);
});

it("rejects replacement of actor or transaction in domain, before commit", async () => {
  for (const field of ["actor", "tx"] as const) {
    const sample = setup();
    sample.options.domain = async (current) => {
      if (field === "actor") current.actor = { ...actor };
      else current.tx = {} as Prisma.TransactionClient;
      return "ok";
    };
    await assert.rejects(runCommand(sample.ctx, sample.options), /Command context replaced during domain/);
    assert.equal(sample.order.includes("transaction-committed"), false);
  }
});

it("idempotency port fails closed before transaction", async () => {
  const sample = setup();
  sample.options.idempotencyKey = "key-1";
  sample.options.idempotencyPort = new UnimplementedIdempotency();
  await assert.rejects(runCommand(sample.ctx, sample.options), /not implemented/);
  assert.equal(sample.factoryCalls(), 0);
});

it("maps errors into contract envelope without leaking exception text", () => {
  assert.deepEqual(mapCommandError(new DomainError("WRONG_STATE", 409), "rid"), {
    status: 409, body: { code: "WRONG_STATE", message: "Conflict", requestId: "rid" },
  });
  assert.deepEqual(mapCommandError(new TokenError("INVALID_TOKEN", "secret", 401), "rid"), {
    status: 401, body: { code: "INVALID_TOKEN", message: "Authentication required", requestId: "rid" },
  });
  assert.deepEqual(mapCommandError(new Error("secret"), "rid"), {
    status: 503, body: { code: "COMMAND_UNAVAILABLE", message: "Command unavailable", requestId: "rid" },
  });
});

it("replay checks identity and policy, then skips domain and transaction", async () => {
  const sample = setup();
  sample.options.idempotencyKey = "valid-key-12345678";
  sample.options.payload = { b: 2, a: 1 };
  sample.options.domain = async () => { throw new Error("domain reached on replay"); };
  sample.options.idempotencyPort = fakePort({
    lookup: async (scope) => {
      assert.deepEqual({ actor: scope.actorOrClient, method: scope.method, route: scope.routeKey },
        { actor: actor.userId, method: "POST", route: sample.options.action });
      assert.match(scope.payloadSha256, /^[0-9a-f]{64}$/);
      return { kind: "replay", result: "stored" };
    },
  });
  assert.equal(await runCommand(sample.ctx, sample.options), "stored");
  assert.deepEqual(sample.order, ["authenticate", "resolve-tenant", "authorize", "idempotency"]);
  assert.equal(sample.factoryCalls(), 0);

  const denied = setup();
  denied.options.action = "admin:partner:manage";
  denied.options.idempotencyKey = sample.options.idempotencyKey;
  denied.options.idempotencyPort = sample.options.idempotencyPort;
  await assert.rejects(runCommand(denied.ctx, denied.options), { name: "PolicyError" });
  assert.deepEqual(denied.order, ["authenticate", "resolve-tenant", "authorize"]);
});

it("claim, outbox insert and completion use domain transaction before commit", async () => {
  const sample = setup();
  written.length = 0;
  const originalCreateMany = tx.outboxMessage.createMany;
  tx.outboxMessage.createMany = (async (args: { data: unknown[] }) => {
    sample.order.push("outbox-in-transaction");
    return originalCreateMany(args as never);
  }) as unknown as typeof originalCreateMany;
  const domain = sample.options.domain;
  sample.options.domain = async (current) => {
    const result = await domain(current);
    current.emit({ aggregateType: "test", aggregateId: "00000000-0000-4000-8000-000000000001",
      aggregateVersion: 1, eventType: "test.created.v1", schemaVersion: "1", payload: { eventId: "e1" },
      destination: "local", correlationId: current.requestId });
    return result;
  };
  sample.options.idempotencyKey = "valid-key-12345678";
  sample.options.idempotencyPort = fakePort({
    lookup: async () => ({ kind: "fresh" }),
    claim: async (client) => { assert.equal(client, tx); sample.order.push("claim"); return { recordId: "record" }; },
    complete: async (client, id, result) => {
      assert.equal(client, tx); assert.equal(id, "record"); assert.equal(result, "ok");
      sample.order.push("complete");
    },
  });
  try { assert.equal(await runCommand(sample.ctx, sample.options), "ok"); }
  finally { tx.outboxMessage.createMany = originalCreateMany; }
  assert.equal(written.length, 1);
  assert.deepEqual(sample.order, [
    "authenticate", "resolve-tenant", "authorize", "idempotency", "domain",
    "transaction-open", "claim", "audit-in-transaction", "outbox-in-transaction", "complete", "transaction-committed", "commit",
  ]);
});

it("transaction retry resets emitted events from the rolled-back attempt", async () => {
  const sample = setup();
  const inserts: number[] = [];
  sample.options.domain = async (current) => {
    current.emit({ aggregateType: "test", aggregateId: "00000000-0000-4000-8000-000000000001",
      aggregateVersion: 1, eventType: "test.created.v1", schemaVersion: "1", payload: { eventId: "e1" },
      destination: "local", correlationId: current.requestId });
    return "ok";
  };
  sample.options.unitOfWork = () => ({ run: async (work) => {
    const fake = { outboxMessage: { createMany: async ({ data }: { data: unknown[] }) => {
      inserts.push(data.length);
    } } } as unknown as Prisma.TransactionClient;
    await work(fake); // Simulate commit failure: first attempt rolls back.
    return work(fake);
  } });
  assert.equal(await runCommand(sample.ctx, sample.options), "ok");
  assert.deepEqual(inserts, [1, 1]);
});

it("lost claim escapes UoW, re-looks up and replays", async () => {
  const sample = setup();
  sample.options.idempotencyKey = "valid-key-12345678";
  let lookups = 0;
  sample.options.idempotencyPort = fakePort({
    lookup: async () => ++lookups === 1 ? { kind: "fresh" } : { kind: "replay", result: "stored" },
    claim: async () => { throw new IdempotencyClaimLostError(); },
  });
  sample.options.domain = async () => { throw new Error("domain reached"); };
  assert.equal(await runCommand(sample.ctx, sample.options), "stored");
  assert.equal(sample.runs(), 1);
  assert.equal(lookups, 2);
  assert.equal(sample.ctx.tx, undefined);
});

it("lost claim after rollback retries once; unresolved conflict returns 409", async () => {
  const sample = setup();
  sample.options.idempotencyKey = "valid-key-12345678";
  let attempts = 0;
  sample.options.idempotencyPort = fakePort({
    lookup: async () => ({ kind: "fresh" }),
    claim: async () => {
      if (++attempts < 2) throw new IdempotencyClaimLostError();
      return { recordId: "record" };
    },
    complete: async () => {},
  });
  assert.equal(await runCommand(sample.ctx, sample.options), "ok");
  assert.equal(attempts, 2);

  const stuck = setup();
  stuck.options.idempotencyKey = "valid-key-12345678";
  stuck.options.idempotencyPort = fakePort({
    lookup: async () => ({ kind: "fresh" }),
    claim: async () => { throw new IdempotencyClaimLostError(); },
  });
  await assert.rejects(runCommand(stuck.ctx, stuck.options), (error) => {
    assert.deepEqual(mapCommandError(error, "rid"), {
      status: 409, body: { code: "IDEMPOTENCY_IN_PROGRESS", message: "Conflict", requestId: "rid" },
    });
    return true;
  });
});

it("invalid key fails before lookup and conflict maps to 409", async () => {
  const sample = setup();
  sample.options.idempotencyKey = "short";
  sample.options.idempotencyPort = fakePort({ lookup: async () => { throw new Error("unexpected lookup"); } });
  await assert.rejects(runCommand(sample.ctx, sample.options), { code: "IDEMPOTENCY_KEY_INVALID" });
  assert.equal(sample.factoryCalls(), 0);
  sample.options.idempotencyKey = "valid-key-12345678";
  const conflict = new DomainError("IDEMPOTENCY_CONFLICT", 409);
  sample.options.idempotencyPort = fakePort({ lookup: async () => { throw conflict; } });
  await assert.rejects(runCommand({ requestId: "new" }, sample.options), (error) => {
    assert.deepEqual(mapCommandError(error, "rid"), {
      status: 409, body: { code: "IDEMPOTENCY_CONFLICT", message: "Conflict", requestId: "rid" },
    });
    return true;
  });
});
