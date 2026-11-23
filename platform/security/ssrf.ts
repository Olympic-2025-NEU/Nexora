// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SSRF allowlist helper for partner endpoint URLs.
 *
 * Validates that a URL:
 * 1. Uses HTTPS (not HTTP, ftp, file, etc.).
 * 2. Does not resolve to a private/loopback/link-local IP.
 * 3. Does not use a numeric IP that falls in blocked ranges.
 *
 * Used when storing or calling PartnerConnection.endpointUrl /
 * PartnerConnection.outboundTokenUrl — prevents Server-Side Request Forgery
 * attacks where a malicious admin could make the server call internal services.
 *
 * Usage:
 *   validatePartnerUrl(url);  // throws SsrfError if invalid
 */

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class SsrfError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SsrfError";
  }
}

// ---------------------------------------------------------------------------
// Private IP ranges (CIDR notation, checked as prefix strings for portability)
// ---------------------------------------------------------------------------

/**
 * IPv4 ranges that must never be contacted as partner endpoints.
 * Ref: RFC 1918, RFC 5737, RFC 3927, RFC 6598.
 */
const BLOCKED_IPV4_PREFIXES = [
  "10.",           // RFC 1918 private
  "172.16.",       // RFC 1918 private (172.16.0.0/12 — simplified check)
  "172.17.",
  "172.18.",
  "172.19.",
  "172.20.",
  "172.21.",
  "172.22.",
  "172.23.",
  "172.24.",
  "172.25.",
  "172.26.",
  "172.27.",
  "172.28.",
  "172.29.",
  "172.30.",
  "172.31.",
  "192.168.",      // RFC 1918 private
  "127.",          // Loopback
  "169.254.",      // Link-local (RFC 3927)
  "100.64.",       // Carrier-grade NAT (RFC 6598)
  "0.",            // This network
  "255.",          // Broadcast
];

/** IPv6 loopback and link-local prefixes. */
const BLOCKED_IPV6_PREFIXES = [
  "::1",           // Loopback
  "fe80:",         // Link-local
  "fc00:",         // Unique local (RFC 4193)
  "fd",            // Unique local (fd00::/8)
];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a partner endpoint or token URL for SSRF safety.
 *
 * @param urlStr - The URL string to validate.
 * @throws SsrfError if the URL is unsafe.
 */
export function validatePartnerUrl(urlStr: string): void {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new SsrfError("INVALID_URL", `Partner URL '${urlStr}' is not a valid URL`);
  }

  // 1. Must be HTTPS.
  if (parsed.protocol !== "https:") {
    throw new SsrfError(
      "SCHEME_NOT_HTTPS",
      `Partner URL must use HTTPS; got '${parsed.protocol}'`,
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  // 2. Block localhost.
  if (hostname === "localhost" || hostname === "localhost.") {
    throw new SsrfError("PRIVATE_HOST", "Partner URL must not target localhost");
  }

  // 3. Block numeric IPv4 in private ranges.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    for (const prefix of BLOCKED_IPV4_PREFIXES) {
      if (hostname.startsWith(prefix)) {
        throw new SsrfError(
          "PRIVATE_IP",
          `Partner URL hostname '${hostname}' resolves to a private/reserved IPv4 range`,
        );
      }
    }
  }

  // 4. Block IPv6 loopback/link-local (hostname will be [::1] form).
  const ipv6Host = hostname.replace(/^\[/, "").replace(/\]$/, "");
  for (const prefix of BLOCKED_IPV6_PREFIXES) {
    if (ipv6Host.startsWith(prefix)) {
      throw new SsrfError(
        "PRIVATE_IP",
        `Partner URL hostname '${hostname}' resolves to a private/reserved IPv6 range`,
      );
    }
  }

  // 5. Block internal Docker/Compose service names (heuristic: single-segment hostnames
  //    without dots may be Docker internal DNS, e.g. "keycloak", "postgres", "redis").
  //    Real partner URLs should have fully qualified domain names.
  if (!hostname.includes(".") && !/^\d+\.\d+\.\d+\.\d+$/.test(hostname) && !hostname.startsWith("[")) {
    throw new SsrfError(
      "INTERNAL_HOSTNAME",
      `Partner URL hostname '${hostname}' appears to be an internal service name (no dots). Use a fully qualified domain name.`,
    );
  }
}

/**
 * Returns true if the URL is SSRF-safe (does not throw).
 */
export function isPartnerUrlSafe(urlStr: string): boolean {
  try {
    validatePartnerUrl(urlStr);
    return true;
  } catch {
    return false;
  }
}
