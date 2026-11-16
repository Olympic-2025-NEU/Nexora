/**
 * D03 spike: Prisma $transaction rollback, optimistic version, stock contention.
 * Run: npx tsx scripts/spikes/d03-prisma-tx.ts
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../platform/persistence/prisma";
import { transaction } from "../../platform/persistence/transaction";

type Result = { name: string; ok: boolean; detail: string };

async function resetSpikeTables() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE
      trading.spike_document,
      inventory.spike_stock_movement,
      inventory.spike_stock_balance,
      platform.spike_audit_log,
      platform.spike_outbox_message
     RESTART IDENTITY CASCADE`,
  );
}

async function testRollback(): Promise<Result> {
  const name = "rollback_mid_tx";
  const docId = randomUUID();
  const warehouseId = randomUUID();
  const batchId = randomUUID();

  try {
    await transaction.run(async (tx) => {
      await tx.spikeDocument.create({
        data: {
          id: docId,
          status: "confirmed",
          quantity: new Prisma.Decimal("5"),
          version: 1,
        },
      });
      await tx.spikeStockMovement.create({
        data: {
          id: randomUUID(),
          warehouseId,
          batchId,
          delta: new Prisma.Decimal("-5"),
          sourceDocumentId: docId,
        },
      });
      await tx.spikeAuditLog.create({
        data: {
          id: randomUUID(),
          action: "document.confirm",
          targetType: "spike_document",
          targetId: docId,
          outcome: "ok",
        },
      });
      await tx.spikeOutboxMessage.create({
        data: {
          id: randomUUID(),
          aggregateType: "spike_document",
          aggregateId: docId,
          eventType: "trading.issue.confirmed.v1",
          payloadJson: { documentId: docId },
        },
      });
      throw new Error("injected_failure_after_writes");
    });
    return { name, ok: false, detail: "expected throw, transaction committed" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("injected_failure_after_writes")) {
      return { name, ok: false, detail: `unexpected error: ${msg}` };
    }
  }

  const [docs, moves, audits, outbox] = await Promise.all([
    prisma.spikeDocument.count(),
    prisma.spikeStockMovement.count(),
    prisma.spikeAuditLog.count(),
    prisma.spikeOutboxMessage.count(),
  ]);
  const ok = docs === 0 && moves === 0 && audits === 0 && outbox === 0;
  return {
    name,
    ok,
    detail: ok
      ? "all four tables empty after rollback"
      : `leftover counts doc=${docs} move=${moves} audit=${audits} outbox=${outbox}`,
  };
}

async function testOptimisticVersion(): Promise<Result> {
  const name = "optimistic_version";
  const id = randomUUID();
  await prisma.spikeDocument.create({
    data: {
      id,
      status: "draft",
      quantity: new Prisma.Decimal("1"),
      version: 1,
    },
  });

  const first = await prisma.spikeDocument.updateMany({
    where: { id, version: 1 },
    data: { status: "confirmed", version: { increment: 1 } },
  });
  const second = await prisma.spikeDocument.updateMany({
    where: { id, version: 1 },
    data: { status: "cancelled", version: { increment: 1 } },
  });

  const row = await prisma.spikeDocument.findUniqueOrThrow({ where: { id } });
  const ok = first.count === 1 && second.count === 0 && row.version === 2 && row.status === "confirmed";
  return {
    name,
    ok,
    detail: ok
      ? "second updateMany count=0 (409 path); version=2"
      : `first=${first.count} second=${second.count} version=${row.version} status=${row.status}`,
  };
}

async function testStockContention(): Promise<Result> {
  const name = "concurrent_stock_contention";
  const balanceId = randomUUID();
  const warehouseId = randomUUID();
  const batchId = randomUUID();

  await prisma.spikeStockBalance.create({
    data: {
      id: balanceId,
      warehouseId,
      batchId,
      quantity: new Prisma.Decimal("10"),
      version: 1,
    },
  });

  async function tryIssue(docId: string, qty: string) {
    return transaction.run(async (tx) => {
      const bal = await tx.spikeStockBalance.findUniqueOrThrow({
        where: { id: balanceId },
      });
      const next = new Prisma.Decimal(bal.quantity).minus(qty);
      if (next.lessThan(0)) {
        throw new Error("INSUFFICIENT_STOCK");
      }
      const updated = await tx.spikeStockBalance.updateMany({
        where: { id: balanceId, version: bal.version },
        data: {
          quantity: next,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new Error("VERSION_CONFLICT");
      }
      await tx.spikeDocument.create({
        data: {
          id: docId,
          status: "confirmed",
          quantity: new Prisma.Decimal(qty),
          version: 1,
        },
      });
      await tx.spikeStockMovement.create({
        data: {
          id: randomUUID(),
          warehouseId,
          batchId,
          delta: new Prisma.Decimal(qty).negated(),
          sourceDocumentId: docId,
        },
      });
      return "ok" as const;
    });
  }

  const docA = randomUUID();
  const docB = randomUUID();
  const settled = await Promise.allSettled([
    tryIssue(docA, "8"),
    tryIssue(docB, "8"),
  ]);

  const successes = settled.filter((s) => s.status === "fulfilled").length;
  const failures = settled.filter((s) => s.status === "rejected");
  const bal = await prisma.spikeStockBalance.findUniqueOrThrow({
    where: { id: balanceId },
  });
  const moves = await prisma.spikeStockMovement.count({
    where: { warehouseId, batchId },
  });

  const ok =
    successes === 1 &&
    failures.length === 1 &&
    moves === 1 &&
    new Prisma.Decimal(bal.quantity).equals(2);

  return {
    name,
    ok,
    detail: ok
      ? "one issue committed (qty 8), balance=2, one failure"
      : `successes=${successes} failures=${failures.length} balance=${bal.quantity} moves=${moves} err=${failures
          .map((f) => (f.status === "rejected" ? String(f.reason) : ""))
          .join(" | ")}`,
  };
}

async function main() {
  const results: Result[] = [];
  await resetSpikeTables();
  results.push(await testRollback());
  await resetSpikeTables();
  results.push(await testOptimisticVersion());
  await resetSpikeTables();
  results.push(await testStockContention());

  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}: ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    process.exitCode = 1;
  } else {
    console.log("D03_SPIKE_OK");
  }
}

main()
  .catch((err) => {
    console.error("D03_SPIKE_ERROR", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
