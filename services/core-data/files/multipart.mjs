// SPDX-License-Identifier: AGPL-3.0-only
import Busboy from 'busboy';
import { FileError, MAX_FILE_BYTES } from './file-policy.mjs';

/** A bounded multipart parser: one file, no undeclared fields, no raw filename retained. */
export function parseFileUpload(request) {
  const length = Number(request.headers['content-length']);
  if (Number.isFinite(length) && length > MAX_FILE_BYTES + 8192) {
    throw new FileError('FILE_SIZE_INVALID');
  }
  if (!/^multipart\/form-data\s*;/i.test(request.headers['content-type'] ?? '')) {
    throw new FileError('FILE_MULTIPART_REQUIRED', 400);
  }
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({ headers: request.headers, limits: {
        files: 1, fields: 3, parts: 4, fileSize: MAX_FILE_BYTES, fieldSize: 128,
      } });
    } catch { reject(new FileError('FILE_MULTIPART_INVALID', 400)); return; }
    let invalid;
    let fileCount = 0;
    let declaredType;
    const chunks = [];
    const fields = {};
    parser.on('file', (name, stream, info) => {
      fileCount++;
      if (name !== 'file') invalid = new FileError('FILE_MULTIPART_INVALID', 400);
      declaredType = info.mimeType;
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('limit', () => { invalid = new FileError('FILE_SIZE_INVALID'); });
      stream.on('error', () => { invalid = new FileError('FILE_MULTIPART_INVALID', 400); });
    });
    parser.on('field', (name, value, info) => {
      if (!['ownerType', 'ownerId', 'visibility'].includes(name) ||
          Object.hasOwn(fields, name) || info.valueTruncated) {
        invalid = new FileError('FILE_MULTIPART_INVALID', 400);
      } else fields[name] = value;
    });
    for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit']) {
      parser.on(event, () => { invalid = new FileError('FILE_MULTIPART_INVALID', 400); });
    }
    parser.on('error', () => reject(new FileError('FILE_MULTIPART_INVALID', 400)));
    parser.on('finish', () => {
      if (invalid) reject(invalid);
      else if (fileCount !== 1) reject(new FileError('FILE_REQUIRED', 400));
      else resolve({ body: Buffer.concat(chunks), declaredType, fields });
    });
    request.on('error', () => reject(new FileError('FILE_MULTIPART_INVALID', 400)));
    request.pipe(parser);
  });
}
