// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";

export interface AuthConfig {
  publicBaseUrl: URL;
  issuerUrl: URL;
  backchannelUrl: URL;
  jwksUrl: URL;
  redirectUri: string;
  clientId: string;
  gatewayUrl: URL;
  sessionKey: Uint8Array;
  secureCookies: boolean;
}

export function authConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const required = (name: string) => {
    const value = env[name];
    if (!value || value.startsWith("CHANGE_ME_")) throw new Error(`DX-Lab missing ${name}`);
    return value;
  };
  const publicBaseUrl = new URL(required("PUBLIC_BASE_URL"));
  const issuerUrl = new URL(required("OIDC_ISSUER_URL"));
  const backchannelUrl = new URL(required("OIDC_BASE_URL"));
  const jwksUrl = new URL(required("OIDC_JWKS_URL"));
  const gatewayUrl = new URL(required("GATEWAY_INTERNAL_URL"));
  const redirectUri = required("OIDC_REDIRECT_URI_DXLAB");
  const clientId = required("OIDC_CLIENT_ID_DXLAB");
  const keyHex = required("DXLAB_SESSION_SECRET");
  if (!/^[a-f0-9]{64}$/i.test(keyHex)) throw new Error("DX-Lab invalid DXLAB_SESSION_SECRET");
  if (new URL(redirectUri).href !== new URL("/dxlab/callback", publicBaseUrl).href) {
    throw new Error("DX-Lab invalid OIDC_REDIRECT_URI_DXLAB");
  }
  if (publicBaseUrl.protocol !== "https:" && publicBaseUrl.hostname !== "127.0.0.1") {
    throw new Error("DX-Lab requires HTTPS outside loopback");
  }
  if (gatewayUrl.hostname !== "gateway" || gatewayUrl.pathname !== "/") {
    throw new Error("DX-Lab invalid GATEWAY_INTERNAL_URL");
  }
  if (backchannelUrl.protocol !== "http:" && backchannelUrl.protocol !== "https:") {
    throw new Error("DX-Lab invalid OIDC_BASE_URL");
  }
  return {
    publicBaseUrl, issuerUrl, backchannelUrl, jwksUrl, redirectUri, clientId,
    gatewayUrl, sessionKey: Uint8Array.from(Buffer.from(keyHex, "hex")),
    secureCookies: publicBaseUrl.protocol === "https:",
  };
}
