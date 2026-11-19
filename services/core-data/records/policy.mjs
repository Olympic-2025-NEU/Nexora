// SPDX-License-Identifier: AGPL-3.0-only

export class RecordError extends Error {
  constructor(code, status = 422) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function authorizeKind(actor, kind, action) {
  if (kind !== 'evidence_metadata') throw new RecordError('POLICY_DENIED', 403);
  if (!actor?.sub || !actor.membershipId || !actor.organizationId) {
    throw new RecordError('POLICY_DENIED', 403);
  }
  if (['create', 'update'].includes(action) && !['administrator', 'staff'].includes(actor.role)) {
    throw new RecordError('POLICY_DENIED', 403);
  }
  if (!['create', 'read', 'update'].includes(action)) throw new RecordError('POLICY_DENIED', 403);
}

export async function authorizeEvidence(db, actor, payload, action) {
  authorizeKind(actor, 'evidence_metadata', action);
  const { ownerType, ownerId, attachmentId } = payload;
  if (!['membership', 'organization'].includes(ownerType) || !uuid.test(ownerId)) {
    throw new RecordError('OWNER_INVALID');
  }
  if (ownerType === 'membership') {
    const owner = await db.membership(ownerId);
    if (!owner || owner.status !== 'active' || owner.organizationId !== actor.organizationId ||
        (owner.id !== actor.membershipId && actor.role !== 'administrator')) {
      throw new RecordError('RECORD_NOT_FOUND', 404);
    }
  } else {
    const owner = await db.organization(ownerId);
    if (!owner || owner.status !== 'active' || owner.id !== actor.organizationId ||
        !['administrator', 'staff'].includes(actor.role)) {
      throw new RecordError('RECORD_NOT_FOUND', 404);
    }
  }
  if (!uuid.test(attachmentId)) throw new RecordError('ATTACHMENT_INVALID');
  const attachment = await db.attachment(attachmentId);
  if (!attachment || attachment.bucket !== 'private' ||
      attachment.visibility !== 'private' || attachment.ownerType !== 'core_record' ||
      attachment.ownerId !== null ||
      (attachment.createdBySub !== actor.sub && actor.role !== 'administrator')) {
    throw new RecordError('ATTACHMENT_NOT_FOUND', 404);
  }
  if (attachment.scanState !== 'clean') throw new RecordError('ATTACHMENT_NOT_CLEAN');
}
