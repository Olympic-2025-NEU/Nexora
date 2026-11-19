// SPDX-License-Identifier: AGPL-3.0-only
import { PolicyError } from "../access/policy";
import { AuthError } from "../identity/request-auth";
import { ActorResolutionError } from "../identity/resolve-actor";
import { PartnerActorError } from "../identity/partner-actor";
import { TokenError } from "../identity/token";
import { DomainError } from "../kernel/errors";
import { TransactionConflictError, TransactionTimeoutError } from "../persistence/transaction";

type ErrorBody = { code: string; message: string; requestId: string; details?: { field: string; reason: string }[] };

/** api-payloads-v1.md error envelope; avoid exposing raw exception text. */
export function mapCommandError(error: unknown, requestId: string): { status: number; body: ErrorBody } {
  let status = 503;
  let code = "COMMAND_UNAVAILABLE";
  if (error instanceof DomainError) {
    status = [400, 401, 403, 404, 409, 422, 429, 503].includes(error.httpStatus) ? error.httpStatus : 503;
    code = error.code;
  } else if (error instanceof TokenError || error instanceof AuthError ||
    error instanceof ActorResolutionError || error instanceof PartnerActorError) {
    status = error.httpStatus;
    code = error.code;
  } else if (error instanceof PolicyError) {
    status = 403;
    code = "POLICY_DENIED";
  } else if (error instanceof TransactionConflictError) {
    status = 409;
    code = error.code;
  } else if (error instanceof TransactionTimeoutError) {
    code = error.code;
  }
  const message = status === 401 ? "Authentication required" : status === 403 ? "Forbidden" :
    status === 404 ? "Not found" : status === 409 ? "Conflict" :
      status === 400 || status === 422 ? "Invalid request" : "Command unavailable";
  return { status, body: { code, message, requestId } };
}
