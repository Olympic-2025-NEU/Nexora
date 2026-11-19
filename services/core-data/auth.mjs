// SPDX-License-Identifier: AGPL-3.0-only
import { createRemoteJWKSet, jwtVerify } from 'jose';

const forgedHeaders = [
  'x-userinfo', 'x-access-token', 'x-authenticated-user', 'x-remote-user',
  'x-forwarded-user', 'x-consumer-username', 'x-consumer-id', 'x-consumer-custom-id',
];

export class CoreAuthError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function createAuthenticator(db, env) {
  const jwks = createRemoteJWKSet(new URL(env.OIDC_JWKS_URL), { timeoutDuration: 5000 });
  return async (request) => {
    if (forgedHeaders.some((name) => request.headers[name] !== undefined)) {
      throw new CoreAuthError('FORGED_IDENTITY_HEADER', 403);
    }
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !/^Bearer [^\s]+$/.test(header)) {
      throw new CoreAuthError('TOKEN_MISSING', 401);
    }
    let claims;
    try {
      ({ payload: claims } = await jwtVerify(header.slice(7), jwks, {
        issuer: env.OIDC_ISSUER_URL, audience: env.OIDC_AUDIENCE,
      }));
    } catch {
      throw new CoreAuthError('TOKEN_INVALID', 401);
    }
    if (typeof claims.sub !== 'string' || !claims.sub) throw new CoreAuthError('TOKEN_INVALID', 401);
    const member = await db.membership.findUnique({ where: { keycloakSub: claims.sub },
      include: { organization: true } });
    if (!member || member.status !== 'active' || member.organization.status !== 'active') {
      throw new CoreAuthError('MEMBERSHIP_INACTIVE', 403);
    }
    return { sub: member.keycloakSub, actorSub: member.keycloakSub, role: member.role,
      membershipId: member.id, organizationId: member.organizationId };
  };
}
