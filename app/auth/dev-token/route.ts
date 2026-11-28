// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Local-only token helper for Admin UI smoke.
 * Supports password grant and refresh_token grant.
 * Disabled unless ALLOW_DEV_PASSWORD_LOGIN=true. Not for production.
 */
import { NextResponse } from "next/server";

type Body = {
  username?: string;
  password?: string;
  totp?: string;
  refreshToken?: string;
  grantType?: "password" | "refresh_token";
};

export async function POST(req: Request) {
  if (process.env.ALLOW_DEV_PASSWORD_LOGIN !== "true") {
    return NextResponse.json({ error: "DEV_LOGIN_DISABLED" }, { status: 404 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const base = (process.env.OIDC_BASE_URL ?? "").replace(/\/$/, "");
  const clientId = process.env.OIDC_CLIENT_ID_ERP ?? "erp-browser";
  if (!base) {
    return NextResponse.json({ error: "OIDC_BASE_URL_MISSING" }, { status: 500 });
  }

  const grantType = body.grantType === "refresh_token" ? "refresh_token" : "password";
  const form = new URLSearchParams({
    grant_type: grantType,
    client_id: clientId,
  });

  if (grantType === "refresh_token") {
    const refreshToken = body.refreshToken?.trim();
    if (!refreshToken) {
      return NextResponse.json({ error: "REFRESH_TOKEN_REQUIRED" }, { status: 400 });
    }
    form.set("refresh_token", refreshToken);
  } else {
    const username = body.username?.trim();
    const password = body.password;
    if (!username || !password) {
      return NextResponse.json({ error: "USERNAME_PASSWORD_REQUIRED" }, { status: 400 });
    }
    form.set("username", username);
    form.set("password", password);
    if (body.totp) {
      if (typeof body.totp !== "string" || !/^\d{6,8}$/.test(body.totp))
        return NextResponse.json({ error: "TOTP_INVALID" }, { status: 400 });
      form.set("totp", body.totp);
    }
  }

  const tokenUrl = `${base}/realms/nexora/protocol/openid-connect/token`;
  const upstream = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const json = (await upstream.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!upstream.ok || !json.access_token) {
    const detail = json.error_description;
    const haystack = `${json.error ?? ""} ${detail ?? ""}`.toLowerCase();
    const totpProvided = Boolean(body.totp);
    const looksMfa =
      !totpProvided &&
      (/\b(totp|otp|mfa)\b/.test(haystack) ||
        /missing\s+totp/.test(haystack) ||
        /invalid\s+totp\s+authenticator/.test(haystack) ||
        /account\s+is\s+not\s+fully\s+set\s+up/.test(haystack));

    if (looksMfa) {
      return NextResponse.json(
        {
          error: "MFA_REQUIRED",
          detail,
          message: detail ?? "MFA_REQUIRED",
        },
        { status: 401 },
      );
    }

    const error = json.error ?? "TOKEN_REQUEST_FAILED";
    return NextResponse.json(
      {
        error,
        detail,
        message: detail ?? error,
      },
      { status: 401 },
    );
  }

  return NextResponse.json({
    data: {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? null,
      expiresIn: json.expires_in ?? null,
      refreshExpiresIn: json.refresh_expires_in ?? null,
    },
  });
}
