// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/platform/identity/actor";
import { DomainError } from "@/platform/kernel/errors";

type Context = { tx: Prisma.TransactionClient; actor: Actor; requestId: string };

function project(row: {
  id: string;
  code: string;
  displayName: string;
  status: string;
  contactPhone: string | null;
  contactEmail: string | null;
  note: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    code: row.code,
    displayName: row.displayName,
    status: row.status,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    note: row.note,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertCode(code: string) {
  const trimmed = code.trim();
  if (trimmed.length < 1 || trimmed.length > 64) throw new DomainError("CODE_INVALID", 422);
  return trimmed;
}

function assertName(name: string) {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 200) throw new DomainError("DISPLAY_NAME_INVALID", 422);
  return trimmed;
}

export function createLocalSupplierService() {
  return {
    async list(ctx: Context, opts?: { q?: string; status?: string; limit?: number }) {
      const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
      const where: Prisma.LocalSupplierWhereInput = {
        ...(opts?.status ? { status: opts.status } : {}),
        ...(opts?.q
          ? {
              OR: [
                { code: { contains: opts.q, mode: "insensitive" } },
                { displayName: { contains: opts.q, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const rows = await ctx.tx.localSupplier.findMany({
        where,
        orderBy: [{ displayName: "asc" }, { code: "asc" }],
        take: limit,
      });
      return rows.map(project);
    },

    async view(ctx: Context, id: string) {
      const row = await ctx.tx.localSupplier.findUnique({ where: { id } });
      if (!row) throw new DomainError("LOCAL_SUPPLIER_NOT_FOUND", 404);
      return project(row);
    },

    async create(ctx: Context, input: {
      code: string;
      displayName: string;
      contactPhone?: string | null;
      contactEmail?: string | null;
      note?: string | null;
    }) {
      const code = assertCode(input.code);
      const displayName = assertName(input.displayName);
      try {
        const created = await ctx.tx.localSupplier.create({
          data: {
            id: randomUUID(),
            code,
            displayName,
            contactPhone: input.contactPhone?.trim() || null,
            contactEmail: input.contactEmail?.trim() || null,
            note: input.note?.trim() || null,
            createdBySub: ctx.actor.userId,
          },
        });
        return project(created);
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
          throw new DomainError("LOCAL_SUPPLIER_CODE_EXISTS", 409);
        }
        throw err;
      }
    },

    async update(ctx: Context, id: string, expectedVersion: number, input: {
      displayName?: string;
      status?: string;
      contactPhone?: string | null;
      contactEmail?: string | null;
      note?: string | null;
    }) {
      const existing = await ctx.tx.localSupplier.findUnique({ where: { id } });
      if (!existing) throw new DomainError("LOCAL_SUPPLIER_NOT_FOUND", 404);
      if (existing.version !== expectedVersion) throw new DomainError("VERSION_CONFLICT", 409);
      if (input.status !== undefined && !["active", "inactive"].includes(input.status)) {
        throw new DomainError("STATUS_INVALID", 422);
      }
      const updated = await ctx.tx.localSupplier.update({
        where: { id },
        data: {
          version: { increment: 1 },
          updatedAt: new Date(),
          ...(input.displayName !== undefined ? { displayName: assertName(input.displayName) } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone?.trim() || null } : {}),
          ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail?.trim() || null } : {}),
          ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
        },
      });
      return project(updated);
    },
  };
}
