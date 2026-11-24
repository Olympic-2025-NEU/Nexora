// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M2M Partner Actor resolution.
 *
 * Maps an inbound M2M JWT `client_id` claim to an active PartnerConnection row,
 * and builds a Partner Actor for use in federation route handlers.
 *
 * Trust model:
 * - Gateway OIDC (bearer_only) validates token signature, issuer, audience, expiry.
 * - This module confirms the `client_id` (azp) maps to an active partner connection
 *   with matching `inbound_client_id`.
 * - The scope `federation:write` must be present (checked here and at gateway).
 * - No trust is extended from token claims alone — DB row is authoritative.
 *
 * Usage:
 *   const partnerActor = await resolvePartnerActor(claims, connectionRepo);
 */

import type { NexoraClaims } from "./token.js";

// ---------------------------------------------------------------------------
// Partner Actor
// ---------------------------------------------------------------------------

/** Partner actor for M2M federation requests. Distinct from user Actor. */
export interface PartnerActor {
  /** The local inbound_client_id (from PartnerConnection row). */
  clientId: string;
  /** The Partner.id (UUID) for the matched connection. */
  partnerId: string;
  /** The Partner.code (short identifier). */
  partnerCode: string;
  /** Remote instance bound to the partner record, never supplied by the request. */
  issuerInstanceId: string;
  /** Allowed scopes for this connection. */
  allowedScope: string;
  /** Type discriminant. */
  type: "partner";
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

/** Minimal PartnerConnection row shape (matches system.partner_connection + system.partner). */
export interface PartnerConnectionRow {
  id: string;
  partnerId: string;
  partnerCode: string;
  issuerInstanceId: string;
  /** Partner.status — must be active for M2M trust. */
  partnerStatus?: "active" | "suspended";
  inboundClientId: string;
  allowedInboundScope: string;
  status: "active" | "rotating" | "disabled";
}

/** Port: implement against PrismaClient in infrastructure layer. */
export interface PartnerConnectionRepository {
  findByInboundClientId(clientId: string): Promise<PartnerConnectionRow | null>;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class PartnerActorError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: 401 | 403 = 403,
  ) {
    super(message);
    this.name = "PartnerActorError";
  }
}

// ---------------------------------------------------------------------------
// resolvePartnerActor
// ---------------------------------------------------------------------------

/**
 * Resolve a PartnerActor from verified JWT claims and the PartnerConnection DB.
 *
 * Rules:
 * - `azp` (authorized party / client_id) must match an active PartnerConnection row.
 * - PartnerConnection.status must be 'active' (not 'rotating' or 'disabled').
 * - Token must contain the required `federation:write` scope (checked here as defence-in-depth).
 * - Partner.status must be active when provided by the repository (P05 harden).
 * - Self-declared issuerInstanceId in request bodies is never trusted here.
 */
export async function resolvePartnerActor(
  claims: NexoraClaims & { azp?: string; client_id?: string; scope?: string },
  repo: PartnerConnectionRepository,
): Promise<PartnerActor> {
  // Extract client_id from azp claim (Keycloak sets azp for service accounts).
  const clientId = claims.azp ?? claims.client_id;
  if (!clientId) {
    throw new PartnerActorError(
      "MISSING_CLIENT_ID",
      "Token has no azp/client_id claim — M2M tokens must include azp",
      401,
    );
  }

  // Scope check (defence-in-depth; gateway also enforces this).
  const scope = claims.scope ?? "";
  const requiredScope = "federation:write";
  if (!scope.split(" ").includes(requiredScope)) {
    throw new PartnerActorError(
      "MISSING_SCOPE",
      `Token scope '${scope}' does not include required '${requiredScope}'`,
      403,
    );
  }

  // DB lookup — client_id mapping is authoritative; ignore any caller-supplied issuer.
  const connection = await repo.findByInboundClientId(clientId);
  if (!connection) {
    throw new PartnerActorError(
      "PARTNER_NOT_FOUND",
      `No active PartnerConnection found for client_id '${clientId}'`,
      403,
    );
  }

  if (connection.status !== "active") {
    throw new PartnerActorError(
      "PARTNER_CONNECTION_INACTIVE",
      `PartnerConnection status is '${connection.status}' for client_id '${clientId}'`,
      403,
    );
  }

  if (connection.partnerStatus && connection.partnerStatus !== "active") {
    throw new PartnerActorError(
      "PARTNER_SUSPENDED",
      `Partner status is '${connection.partnerStatus}' for client_id '${clientId}'`,
      403,
    );
  }

  if (
    connection.allowedInboundScope &&
    connection.allowedInboundScope !== requiredScope &&
    !scope.split(" ").includes(connection.allowedInboundScope)
  ) {
    throw new PartnerActorError(
      "SCOPE_MISMATCH",
      `Token scope does not satisfy connection allowedInboundScope`,
      403,
    );
  }

  return {
    clientId: connection.inboundClientId,
    partnerId: connection.partnerId,
    partnerCode: connection.partnerCode,
    issuerInstanceId: connection.issuerInstanceId,
    allowedScope: connection.allowedInboundScope,
    type: "partner",
  };
}
