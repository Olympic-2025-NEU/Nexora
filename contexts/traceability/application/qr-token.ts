// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import canonicalize from "canonicalize";
import type { Actor } from "../../../platform/identity/actor";
import { checkPolicy } from "../../../platform/access/policy";
import { prismaAuditRecorder } from "../../../platform/audit/prisma-audit-recorder";
import { DomainError } from "../../../platform/kernel/errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const KEY = /^[A-Za-z0-9_-]{16,128}$/;
const POLICY_VERSION = /^v[1-9][0-9]*$/;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export function newQrToken() { return randomBytes(32).toString("base64url"); }
export function validQrToken(token: string) { return TOKEN.test(token); }

export function passportBaseUrl(raw: string | undefined) {
  if (!raw) throw new DomainError("PUBLIC_BASE_URL_REQUIRED", 503);
  let url: URL;
  try { url = new URL(raw); } catch { throw new DomainError("PUBLIC_BASE_URL_INVALID", 503); }
  if ((url.protocol !== "https:" && !(url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname))) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash)
    throw new DomainError("PUBLIC_BASE_URL_INVALID", 503);
  return url;
}

export type PublicPassport = { productName: string; publicLotCode: string;
  originIssuer: string; timeline: { type: string; occurredAt: string; recordedAt: string;
    issuer: string; sourceId: string; verificationState: string;
    sentQuantity?: string; actualQuantity?: string;
    evidence: { id: string; checksum: string; url?: string }[] }[];
  verificationState: string; gaps: string[]; asOf: string };

/** A DB row is treated as untrusted: accept only the exact seven-field public contract. */
export function safePublicPassport(value: unknown): value is PublicPassport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = ["productName", "publicLotCode", "originIssuer", "timeline",
    "verificationState", "gaps", "asOf"];
  if (Object.keys(row).length !== keys.length || keys.some((key) => !(key in row))) return false;
  if (["productName", "publicLotCode", "originIssuer", "verificationState", "asOf"]
    .some((key) => typeof row[key] !== "string" || (row[key] as string).length > 500)) return false;
  if (!Array.isArray(row.gaps) || row.gaps.length > 200 ||
      row.gaps.some((gap) => typeof gap !== "string" || gap.length > 128)) return false;
  if (!Array.isArray(row.timeline) || row.timeline.length > 2000 ||
      row.timeline.some((item) => !item || typeof item !== "object" || Array.isArray(item) ||
        ["occurredAt", "recordedAt", "issuer", "sourceId", "type", "verificationState", "evidence"]
          .some((key) => !(key in item)) ||
        Object.keys(item).some((key) => !["occurredAt", "recordedAt", "issuer", "sourceId",
          "type", "verificationState", "evidence", "sentQuantity", "actualQuantity"].includes(key)) ||
        ["occurredAt", "recordedAt", "issuer", "sourceId", "type", "verificationState"]
          .some((key) => typeof item[key] !== "string" || item[key].length > 500) ||
        !Number.isFinite(Date.parse(item.occurredAt)) ||
        !Number.isFinite(Date.parse(item.recordedAt)) ||
        ["sentQuantity", "actualQuantity"].some((key) => item[key] !== undefined &&
          (typeof item[key] !== "string" || !/^[0-9]+\.[0-9]{3}$/.test(item[key]))) ||
        !Array.isArray(item.evidence) || item.evidence.length > 100 ||
        item.evidence.some((ref: unknown) => {
          if (!ref || typeof ref !== "object" || Array.isArray(ref)) return true;
          const value = ref as Record<string, unknown>;
          return Object.keys(value).sort().join(",") !== "checksum,id" ||
            typeof value.id !== "string" || !UUID.test(value.id) ||
            typeof value.checksum !== "string" || !/^[0-9a-f]{64}$/.test(value.checksum);
        }))) return false;
  if (row.timeline.reduce((sum, item) => sum + item.evidence.length, 0) > 10)
    return false;
  return Number.isFinite(Date.parse(row.asOf as string));
}

export function createQrService(db: PrismaClient, publicBaseUrl?: string) {
  async function scoped(actor: Actor, batchId: string) {
    if (!checkPolicy(actor, "trace:qr:manage").allowed)
      throw new DomainError("POLICY_DENIED", 403);
    if (!UUID.test(batchId)) throw new DomainError("BATCH_NOT_FOUND", 404);
    if (actor.roles.includes("administrator")) return;
    if (!actor.unitIds.length || !await db.documentLine.findFirst({ where: {
      batchId, warehouseId: { in: [...actor.unitIds] }, document: { status: "confirmed" } },
      select: { id: true } })) throw new DomainError("BATCH_NOT_FOUND", 404);
  }
  return {
    async issue(actor: Actor, batchId: string, policyVersion: string,
      idempotencyKey: string, requestId: string) {
      await scoped(actor, batchId);
      if (policyVersion.length > 12 || !POLICY_VERSION.test(policyVersion) ||
          !Number.isSafeInteger(Number(policyVersion.slice(1))) || !KEY.test(idempotencyKey))
        throw new DomainError("QR_REQUEST_INVALID", 422);
      const base = passportBaseUrl(publicBaseUrl);
      const keyHash = sha(`${actor.userId}\0${batchId}\0${idempotencyKey}`);
      if (await db.qrToken.findUnique({ where: { issuanceKeyHash: keyHash }, select: { id: true } }))
        throw new DomainError("QR_ALREADY_ISSUED", 409);
      const token = newQrToken();
      const id = randomUUID();
      await db.$transaction(async (tx) => {
        const projection = await tx.passportProjection.findUnique({ where: { batchId } });
        const policy = await tx.passportPolicy.findFirst({ where: { batchId,
          policyVersion: Number(policyVersion.slice(1)), state: "approved" }, select: { id: true } });
        const batch = await tx.batch.findUnique({ where: { id: batchId },
          select: { qualityStatus: true } });
        if (!projection || projection.state !== "active" ||
            projection.policyVersion !== policyVersion || !policy ||
            batch?.qualityStatus !== "available" ||
            !safePublicPassport(projection.publicPayload) ||
            sha(canonicalize(projection.publicPayload)!) !== projection.checksumHex)
          throw new DomainError("PASSPORT_NOT_PUBLISHED", 409);
        await tx.qrToken.create({ data: { id, batchId, tokenHash: sha(token),
          policyVersion, issuanceKeyHash: keyHash, state: "active",
          expiresAt: new Date(Date.now() + TTL_MS), createdBySub: actor.userId } });
        await prismaAuditRecorder.record(tx, { actor: { kind: "user", sub: actor.userId },
          action: "passport.qr.issue", targetType: "qr_token", targetId: id, requestId,
          after: { status: "active", policyVersion, changedFields: ["status"] } });
      }, { isolationLevel: "Serializable" });
      return { qrUrl: new URL(`/passport/${token}`, base).toString(), tokenId: id };
    },
    async revoke(actor: Actor, batchId: string, tokenId: string, reason: string,
      requestId: string) {
      await scoped(actor, batchId);
      if (!UUID.test(tokenId) || typeof reason !== "string" || !reason.trim() ||
          reason.length > 200) throw new DomainError("QR_REQUEST_INVALID", 422);
      await db.$transaction(async (tx) => {
        const row = await tx.qrToken.findFirst({ where: { id: tokenId, batchId } });
        if (!row) throw new DomainError("QR_NOT_FOUND", 404);
        if (row.state === "revoked") return;
        await tx.qrToken.update({ where: { id: row.id }, data: {
          state: "revoked", revokedAt: new Date() } });
        await prismaAuditRecorder.record(tx, { actor: { kind: "user", sub: actor.userId },
          action: "passport.qr.revoke", targetType: "qr_token", targetId: row.id,
          requestId, before: { status: "active" },
          after: { status: "revoked", reason, changedFields: ["status"] } });
      }, { isolationLevel: "Serializable" });
    },
    async publicPassport(token: string): Promise<PublicPassport | null> {
      if (!validQrToken(token)) return null;
      const row = await db.qrToken.findUnique({ where: { tokenHash: sha(token) },
        include: { batch: { select: { qualityStatus: true, passportProjection: true } } } });
      if (!row || row.state !== "active" || !row.policyVersion || !row.expiresAt ||
          row.expiresAt.getTime() <= Date.now() || row.batch.qualityStatus !== "available")
        return null;
      const projection = row.batch.passportProjection;
      if (!projection || projection.state !== "active" ||
          projection.policyVersion !== row.policyVersion ||
          !safePublicPassport(projection.publicPayload) ||
          sha(canonicalize(projection.publicPayload)!) !== projection.checksumHex) return null;
      const policy = await db.passportPolicy.findFirst({ where: { batchId: row.batchId,
        policyVersion: Number(row.policyVersion.slice(1)), state: "approved" },
        select: { id: true, evidenceVisibility: true } });
      if (!policy) return null;
      const payload = projection.publicPayload as PublicPassport;
      if (policy.evidenceVisibility !== "public") return payload;
      const ids = [...new Set(payload.timeline.flatMap((item) => item.evidence.map((ref) => ref.id)))];
      if (!ids.length) return payload;
      const links = await db.traceEvidence.findMany({ where: { id: { in: ids },
        event: { batchId: row.batchId, verificationState: "local_verified",
          document: { status: "confirmed" } },
        state: "active", visibility: "public", attachment: {
          scanState: "clean", bucket: "private", visibility: "private" } },
        select: { id: true, checksumHex: true, attachment: { select: { sha256Hex: true } } } });
      const valid = new Map(links.filter((link) => link.checksumHex === link.attachment.sha256Hex)
        .map((link) => [link.id, link]));
      const urls = new Map<string, string>();
      const base = passportBaseUrl(publicBaseUrl);
      for (const id of ids) {
        if (!valid.has(id)) continue;
        const capability = newQrToken();
        await db.traceEvidenceAccess.create({ data: { id: randomUUID(),
          tokenHash: sha(capability), qrTokenId: row.id, evidenceId: id,
          expiresAt: new Date(Date.now() + 60_000) } });
        urls.set(id, new URL(`/api/v1/public/evidence/${capability}`, base).toString());
      }
      return { ...payload, timeline: payload.timeline.map((item) => ({ ...item,
        evidence: item.evidence.filter((ref) => urls.has(ref.id)).map((ref) =>
          ({ ...ref, url: urls.get(ref.id)! })) })) };
    },
  };
}
