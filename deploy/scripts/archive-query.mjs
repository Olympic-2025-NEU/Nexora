// SPDX-License-Identifier: AGPL-3.0-only
/** List archive_manifest core records and lag. Usage: node deploy/scripts/archive-query.mjs a */
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { PrismaClient } from "@prisma/client";

const instance = process.argv[2] || "a";
const env = parseEnv(readFileSync(`deploy/instances/${instance}.env`, "utf8"));
const coreUrl = env.CORE_DATABASE_URL;
if (!coreUrl) {
  console.error("CORE_DATABASE_URL missing");
  process.exit(1);
}
const issuer = `nexora-${instance}`;
const core = new PrismaClient({ datasources: { db: { url: coreUrl } } });
const rows = await core.coreRecord.findMany({
  where: { kind: "archive_manifest", sourceType: "archive_partition", sourceId: { startsWith: `${issuer}/` } },
  orderBy: { builtAt: "desc" },
  take: 20,
});
const now = Date.now();
console.log(JSON.stringify({
  instance: issuer,
  count: rows.length,
  manifests: rows.map((row) => {
    const payload = row.payload;
    return {
      sourceId: row.sourceId,
      builtAt: row.builtAt.toISOString(),
      lagSeconds: Math.max(0, Math.floor((now - row.builtAt.getTime()) / 1000)),
      objectKey: payload?.objectKey,
      recordCount: payload?.recordCount,
      sourceMinId: payload?.sourceMinId,
      sourceMaxId: payload?.sourceMaxId,
      sha256Hex: payload?.sha256Hex,
      checkpoint: payload?.checkpoint,
      checksumHex: row.checksumHex,
    };
  }),
}, null, 2));
await core.$disconnect();
