// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient } from "@prisma/client";

/** Internal primitive. Permissioned API and audit belong to P04-T07. */
export async function retryDeadLetter(client: PrismaClient, messageId: string): Promise<boolean> {
  const count = await client.$executeRaw`
    UPDATE platform.outbox_message SET status = 'pending', attempt_count = 0,
      next_attempt_at = now(), last_error_code = NULL, lease_owner = NULL, lease_until = NULL
    WHERE id = ${messageId}::uuid AND status = 'dead_letter'`;
  return count === 1;
}
