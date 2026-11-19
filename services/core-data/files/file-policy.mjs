// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const allowed = new Set(['application/pdf', 'image/png', 'image/jpeg', 'text/plain']);

export class FileError extends Error {
  constructor(code, status = 422) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function validateFile(body, declaredType) {
  if (!Buffer.isBuffer(body) || body.length < 1 || body.length > MAX_FILE_BYTES) {
    throw new FileError('FILE_SIZE_INVALID');
  }
  const mimeType = declaredType?.split(';', 1)[0].trim().toLowerCase();
  if (!allowed.has(mimeType)) throw new FileError('FILE_TYPE_UNSUPPORTED');
  const starts = (...bytes) => bytes.every((byte, index) => body[index] === byte);
  const valid = mimeType === 'application/pdf' ? starts(0x25, 0x50, 0x44, 0x46, 0x2d) :
    mimeType === 'image/png' ? starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) :
      mimeType === 'image/jpeg' ? starts(0xff, 0xd8, 0xff) : validText(body);
  if (!valid) throw new FileError('FILE_CONTENT_MISMATCH');
  return { mimeType, sizeBytes: body.length, sha256Hex: createHash('sha256').update(body).digest('hex') };
}

function validText(body) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
  } catch { return false; }
}

export function validateUploadFields(fields) {
  if (fields.ownerType !== undefined || fields.ownerId !== undefined ||
      (fields.visibility !== undefined && fields.visibility !== 'private')) {
    throw new FileError('FILE_OWNER_POLICY_UNAVAILABLE');
  }
}

export function validateIdempotencyKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{16,128}$/.test(key)) {
    throw new FileError('IDEMPOTENCY_KEY_INVALID', 400);
  }
  return key;
}
