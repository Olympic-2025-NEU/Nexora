// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { RecordError } from './policy.mjs';

const names = ['evidence_metadata', 'trace_projection', 'ot_reading', 'archive_manifest'];
const ajv = new Ajv2020({ strictRequired: false });
addFormats(ajv);
const validators = new Map(names.map((kind) => {
  const schema = JSON.parse(readFileSync(new URL(`../../../contracts/core-records/${kind}.schema.json`, import.meta.url)));
  if (schema.additionalProperties !== false || schema.properties.schemaVersion.const !== 1) {
    throw new Error(`Invalid core record schema: ${kind}`);
  }
  return [kind, new Map([[1, ajv.compile(schema)]])];
}));
const envelope = ajv.compile({ type: 'object', additionalProperties: false,
  required: ['kind', 'payload'], properties: {
    kind: { type: 'string', enum: names }, payload: { type: 'object' },
  } });

export function validateRecord(input) {
  if (!envelope(input)) throw new RecordError('RECORD_ENVELOPE_INVALID');
  const validate = validators.get(input.kind)?.get(input.payload.schemaVersion);
  if (!validate || !validate(input.payload)) throw new RecordError('RECORD_PAYLOAD_INVALID');
  return input;
}
