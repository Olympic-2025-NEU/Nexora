// SPDX-License-Identifier: AGPL-3.0-only
import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { ValidateFunction } from "ajv";
import getLot from "@/services/ai/tools/getLot.schema.json";
import getStock from "@/services/ai/tools/getStock.schema.json";
import getTrace from "@/services/ai/tools/getTrace.schema.json";
import createReceiptDraft from "@/services/ai/tools/createReceiptDraft.schema.json";
import createIssueDraft from "@/services/ai/tools/createIssueDraft.schema.json";
import { DomainError } from "@/platform/kernel/errors";

const schemas = { getLot, getStock, getTrace, createReceiptDraft, createIssueDraft } as const;
export type ToolName = keyof typeof schemas;
export const TOOL_NAMES = Object.freeze(Object.keys(schemas) as ToolName[]);

const ajv = addFormats(new Ajv({ allErrors: false, strict: true, strictRequired: false }));
const validators = Object.fromEntries(
  TOOL_NAMES.map((name) => [name, ajv.compile(schemas[name])]),
) as Record<ToolName, ValidateFunction>;

export function isToolName(value: string): value is ToolName {
  return Object.prototype.hasOwnProperty.call(schemas, value);
}

export function validateToolInput(name: ToolName, input: unknown): Record<string, unknown> {
  if (!validators[name](input)) throw new DomainError("AI_TOOL_INPUT_INVALID", 422);
  return input as Record<string, unknown>;
}
