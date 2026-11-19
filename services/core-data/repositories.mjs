// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Repository factories accept either PrismaClient or the caller's
 * Prisma.TransactionClient. They never open another connection or transaction.
 * Validation and authorization belong to the core-data application layer.
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 */
export function coreRecordRepository(db) {
  return {
    findById(id) {
      return db.coreRecord.findUnique({ where: { id } });
    },
    findBySource(kind, sourceType, sourceId) {
      return db.coreRecord.findUnique({
        where: { kind_sourceType_sourceId: { kind, sourceType, sourceId } },
      });
    },
    create(data) {
      return db.coreRecord.create({ data });
    },
    async replaceIfVersion(id, expectedVersion, data) {
      const result = await db.coreRecord.updateMany({
        where: { id, version: expectedVersion },
        data: { ...data, version: { increment: 1 }, updatedAt: new Date() },
      });
      return result.count === 1 ? db.coreRecord.findUniqueOrThrow({ where: { id } }) : null;
    },
  };
}

/** @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db */
export function attachmentRepository(db) {
  return {
    findById(id) {
      return db.attachment.findUnique({ where: { id } });
    },
    createPending(data) {
      return db.attachment.create({ data: { ...data, scanState: "pending" } });
    },
    async updateIfVersion(id, expectedVersion, data) {
      const result = await db.attachment.updateMany({
        where: { id, version: expectedVersion },
        data: { ...data, version: { increment: 1 }, updatedAt: new Date() },
      });
      return result.count === 1 ? db.attachment.findUniqueOrThrow({ where: { id } }) : null;
    },
  };
}

/** @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db */
export function evidenceAccessRepository(db) {
  return {
    membership(id) { return db.membership.findUnique({ where: { id } }); },
    organization(id) { return db.organization.findUnique({ where: { id } }); },
    attachment(id) { return db.attachment.findUnique({ where: { id } }); },
  };
}
