// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient } from "@prisma/client";

export async function traceLag(app: PrismaClient) {
  const [row] = await app.$queryRaw<{ pending: bigint; seconds: number | null }[]>`
    SELECT count(*)::bigint AS pending,
      EXTRACT(EPOCH FROM now() - min(created_at))::double precision AS seconds
    FROM platform.outbox_message
    WHERE destination = 'traceability' AND status IN ('pending','leased','retry_due','dead_letter')`;
  return { pending: Number(row.pending), seconds: Math.max(0, row.seconds ?? 0) };
}
