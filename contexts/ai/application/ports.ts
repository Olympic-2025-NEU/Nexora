// SPDX-License-Identifier: AGPL-3.0-only
import type { Actor } from "@/platform/identity/actor";
import type { ToolName } from "./tool-registry";

export type ToolContext = {
  actor: Actor;
  authorization: string;
  requestId: string;
  idempotencyKey?: string;
  now?: () => Date;
};

export type BusinessApiPort = {
  get(path: string, authorization: string, requestId: string): Promise<unknown>;
  post(path: string, body: unknown, authorization: string, requestId: string,
    idempotencyKey: string): Promise<unknown>;
};

export type ToolAuditPort = {
  reserve(actor: Actor, tool: ToolName, requestId: string): Promise<boolean>;
  complete(actor: Actor, tool: ToolName, requestId: string,
    outcome: "success" | "deny" | "failure", sourceIds?: string[]): Promise<void>;
};
