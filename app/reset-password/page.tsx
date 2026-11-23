// SPDX-License-Identifier: AGPL-3.0-only
import { ResetPasswordClient } from "./ResetPasswordClient";

function resolveAccountUrl(): string | null {
  const fromEnv = process.env.OIDC_ACCOUNT_URL?.trim();
  if (fromEnv) return fromEnv;
  const port = process.env.KEYCLOAK_HOST_PORT?.trim();
  if (port) {
    return `http://127.0.0.1:${port}/realms/nexora/account/`;
  }
  return null;
}

export default function ResetPasswordPage() {
  return <ResetPasswordClient accountUrl={resolveAccountUrl()} />;
}
