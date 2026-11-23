// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  createTransaction, isRetryableTransactionError, orderForLocking,
  TransactionConflictError, TransactionTimeoutError,
} from "./transaction";

function fakeClient(run: (attempt: number) => Promise<unknown>) {
  let attempts = 0;
  const options: unknown[] = [];
  const client = {
    $transaction(_work: (tx: Prisma.TransactionClient) => Promise<unknown>, opts: unknown) {
      options.push(opts);
      return run(++attempts);
    },
  } as unknown as PrismaClient;
  return { client, options, attempts: () => attempts };
}

describe("Prisma Unit of Work", () => {
  it("retries only serialization/deadlock errors within the configured bound", async () => {
    const retryable = [
      { code: "P2034" },
      { code: "P2010", meta: { code: "40001" } },
      { code: "40P01" },
    ];
    for (const failure of retryable) {
      const fake = fakeClient(async (attempt) => {
        if (attempt < 3) throw failure;
        return "committed";
      });
      const result = await createTransaction(fake.client, { retryDelayMs: 0 }).run(async () => "unused");
      assert.equal(result, "committed");
      assert.equal(fake.attempts(), 3);
      assert.deepEqual(fake.options[0], {
        isolationLevel: "Serializable", maxWait: 2_000, timeout: 10_000,
      });
    }
  });

  it("returns a stable conflict after retry budget is exhausted", async () => {
    const fake = fakeClient(async () => { throw { code: "P2034" }; });
    await assert.rejects(
      createTransaction(fake.client, { maxRetries: 1, retryDelayMs: 0 }).run(async () => undefined),
      TransactionConflictError,
    );
    assert.equal(fake.attempts(), 2);
  });

  it("never retries domain, unique or timeout errors", async () => {
    const domain = new Error("insufficient stock");
    const unique = { code: "P2002" };
    for (const failure of [domain, unique]) {
      const fake = fakeClient(async () => { throw failure; });
      await assert.rejects(
        createTransaction(fake.client, { retryDelayMs: 0 }).run(async () => undefined),
        (actual) => actual === failure,
      );
      assert.equal(fake.attempts(), 1);
    }
    const timeout = Object.assign(new Error("Transaction already expired"), { code: "P2028" });
    const fake = fakeClient(async () => { throw timeout; });
    await assert.rejects(
      createTransaction(fake.client, { retryDelayMs: 0 }).run(async () => undefined),
      TransactionTimeoutError,
    );
    assert.equal(fake.attempts(), 1);
    assert.equal(isRetryableTransactionError(timeout), false);
  });

  it("rejects unbounded settings and sorts lock keys without mutating the caller", () => {
    const fake = fakeClient(async () => undefined);
    assert.throws(() => createTransaction(fake.client, { maxRetries: 4 }));
    assert.throws(() => createTransaction(fake.client, { timeoutMs: 0 }));
    const locks = ["warehouse-b/batch-2", "warehouse-a/batch-3", "warehouse-a/batch-1"];
    assert.deepEqual(orderForLocking(locks, (item) => item), [
      "warehouse-a/batch-1", "warehouse-a/batch-3", "warehouse-b/batch-2",
    ]);
    assert.equal(locks[0], "warehouse-b/batch-2");
  });
});
