// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Keycloak Admin REST helpers for membership provisioning (admin invite).
 * Uses realm-master admin-cli credentials (KC_BOOTSTRAP_ADMIN_*); never logs secrets.
 */
import { randomBytes } from "node:crypto";
import {
  MEMBERSHIP_ROLES,
  normalizeMembershipRoles,
  rolesRequireMfa,
  type MembershipRole,
} from "@/contexts/system/domain/types";

const REALM = "nexora";
const TIMEOUT_MS = 12_000;

/** Realm roles managed by ERP membership sync (includes legacy for cleanup). */
const MANAGED_REALM_ROLES = new Set<string>([
  ...MEMBERSHIP_ROLES,
  "staff",
  "approver",
  "viewer",
]);

export class KeycloakAdminError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: 422 | 502 | 503 = 502,
  ) {
    super(message);
    this.name = "KeycloakAdminError";
  }
}

export type KeycloakAdminConfig = {
  baseUrl: string;
  adminUsername: string;
  adminPassword: string;
};

export type ProvisionUserInput = {
  username: string;
  displayName: string;
  email?: string | null;
  /** One or more fixed job roles (ADR 0018). */
  roles: MembershipRole[];
  /** When set, used as temporary password; otherwise a random one is generated. */
  temporaryPassword?: string;
};

export type ProvisionUserResult = {
  keycloakSub: string;
  created: boolean;
  /** Present only when this call created the user (or reset was requested). */
  provisionalPassword?: string;
};

function trimBase(url: string): string {
  return url.replace(/\/$/, "");
}

function generateTemporaryPassword(): string {
  // Mix of classes for Keycloak default password policy in local realm.
  const raw = randomBytes(18).toString("base64url");
  return `Tmp-${raw}-Aa1!`;
}

export function readKeycloakAdminConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): KeycloakAdminConfig | null {
  const baseUrl = (env.OIDC_BASE_URL || env.KEYCLOAK_ADMIN_BASE_URL || "").trim();
  const adminUsername = (env.KC_BOOTSTRAP_ADMIN_USERNAME || "").trim();
  const adminPassword = env.KC_BOOTSTRAP_ADMIN_PASSWORD || "";
  if (!baseUrl || !adminUsername || !adminPassword) return null;
  return { baseUrl: trimBase(baseUrl), adminUsername, adminPassword };
}

export function createKeycloakAdminClient(config: KeycloakAdminConfig) {
  let cachedToken: { value: string; expiresAt: number } | null = null;

  async function adminToken(): Promise<string> {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAt > now + 5_000) return cachedToken.value;
    const res = await fetch(`${config.baseUrl}/realms/master/protocol/openid-connect/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: config.adminUsername,
        password: config.adminPassword,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new KeycloakAdminError("KEYCLOAK_ADMIN_AUTH_FAILED", "Keycloak admin auth failed", 503);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      throw new KeycloakAdminError("KEYCLOAK_ADMIN_AUTH_FAILED", "Keycloak admin auth failed", 503);
    }
    cachedToken = {
      value: json.access_token,
      expiresAt: now + Math.max(30, Number(json.expires_in ?? 60)) * 1000,
    };
    return cachedToken.value;
  }

  async function request<T = unknown>(
    path: string,
    init: RequestInit & { method?: string } = {},
  ): Promise<{ status: number; json: T | null; location: string | null }> {
    const token = await adminToken();
    const res = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const location = res.headers.get("location");
    if (res.status === 204 || res.status === 201) {
      return { status: res.status, json: null, location };
    }
    const text = await res.text();
    let json: T | null = null;
    if (text) {
      try {
        json = JSON.parse(text) as T;
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      throw new KeycloakAdminError(
        "KEYCLOAK_ADMIN_REQUEST_FAILED",
        `Keycloak admin request failed (${res.status})`,
        res.status >= 500 ? 503 : 502,
      );
    }
    return { status: res.status, json, location };
  }

  async function findUserByUsername(username: string): Promise<{ id: string; enabled: boolean } | null> {
    const { json } = await request<Array<{ id: string; enabled?: boolean }>>(
      `/admin/realms/${REALM}/users?username=${encodeURIComponent(username)}&exact=true`,
    );
    const row = json?.[0];
    if (!row?.id) return null;
    return { id: row.id, enabled: row.enabled !== false };
  }

  async function findUserById(id: string): Promise<{ id: string; enabled: boolean } | null> {
    const token = await adminToken();
    const res = await fetch(
      `${config.baseUrl}/admin/realms/${REALM}/users/${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new KeycloakAdminError(
        "KEYCLOAK_ADMIN_REQUEST_FAILED",
        `Keycloak admin request failed (${res.status})`,
        res.status >= 500 ? 503 : 502,
      );
    }
    const json = (await res.json()) as { id?: string; enabled?: boolean };
    if (!json?.id) return null;
    return { id: json.id, enabled: json.enabled !== false };
  }

  async function getRealmRole(roleName: string): Promise<{ id: string; name: string }> {
    const { json } = await request<{ id: string; name: string }>(
      `/admin/realms/${REALM}/roles/${encodeURIComponent(roleName)}`,
    );
    if (!json?.id || !json.name) {
      throw new KeycloakAdminError("KEYCLOAK_ROLE_MISSING", `Realm role missing: ${roleName}`, 502);
    }
    return { id: json.id, name: json.name };
  }

  async function replaceRealmRoles(userId: string, roles: MembershipRole[]): Promise<void> {
    const desiredNames = normalizeMembershipRoles(roles);
    if (desiredNames.length === 0) {
      throw new KeycloakAdminError("INVALID_ROLE", "At least one membership role is required", 422);
    }
    const desired = await Promise.all(desiredNames.map((name) => getRealmRole(name)));
    const desiredSet = new Set(desiredNames);
    const { json: current } = await request<Array<{ id: string; name: string }>>(
      `/admin/realms/${REALM}/users/${encodeURIComponent(userId)}/role-mappings/realm`,
    );
    const toRemove = (current ?? []).filter(
      (r) => MANAGED_REALM_ROLES.has(r.name) && !desiredSet.has(r.name as MembershipRole),
    );
    if (toRemove.length) {
      await request(`/admin/realms/${REALM}/users/${encodeURIComponent(userId)}/role-mappings/realm`, {
        method: "DELETE",
        body: JSON.stringify(toRemove),
      });
    }
    const currentNames = new Set((current ?? []).map((r) => r.name));
    const toAdd = desired.filter((r) => !currentNames.has(r.name));
    if (toAdd.length) {
      await request(`/admin/realms/${REALM}/users/${encodeURIComponent(userId)}/role-mappings/realm`, {
        method: "POST",
        body: JSON.stringify(toAdd),
      });
    }
  }

  async function setEnabled(userId: string, enabled: boolean): Promise<void> {
    const { json: user } = await request<Record<string, unknown>>(
      `/admin/realms/${REALM}/users/${encodeURIComponent(userId)}`,
    );
    if (!user) {
      throw new KeycloakAdminError("KEYCLOAK_USER_NOT_FOUND", "Keycloak user not found", 422);
    }
    await request(`/admin/realms/${REALM}/users/${encodeURIComponent(userId)}`, {
      method: "PUT",
      body: JSON.stringify({ ...user, enabled }),
    });
  }

  async function ensureRequiredActions(
    userId: string,
    actions: string[],
  ): Promise<void> {
    const { json: user } = await request<{ requiredActions?: string[] } & Record<string, unknown>>(
      `/admin/realms/${REALM}/users/${encodeURIComponent(userId)}`,
    );
    if (!user) return;
    const existing = new Set(user.requiredActions ?? []);
    let changed = false;
    for (const action of actions) {
      if (!existing.has(action)) {
        existing.add(action);
        changed = true;
      }
    }
    if (!changed) return;
    await request(`/admin/realms/${REALM}/users/${encodeURIComponent(userId)}`, {
      method: "PUT",
      body: JSON.stringify({ ...user, requiredActions: [...existing] }),
    });
  }

  /**
   * Create Keycloak user if missing, sync realm role, return sub.
   * Temporary password is returned only when this call creates the user.
   */
  async function provisionUser(input: ProvisionUserInput): Promise<ProvisionUserResult> {
    const username = input.username.trim();
    if (!/^[a-zA-Z0-9._-]{2,64}$/.test(username)) {
      throw new KeycloakAdminError("INVALID_USERNAME", "Invalid username", 422);
    }

    const roles = normalizeMembershipRoles(input.roles);
    if (roles.length === 0) {
      throw new KeycloakAdminError("INVALID_ROLE", "At least one membership role is required", 422);
    }

    const existing = await findUserByUsername(username);
    if (existing) {
      await replaceRealmRoles(existing.id, roles);
      if (rolesRequireMfa(roles)) {
        await ensureRequiredActions(existing.id, ["CONFIGURE_TOTP"]);
      }
      if (!existing.enabled) await setEnabled(existing.id, true);
      return { keycloakSub: existing.id, created: false };
    }

    const provisionalPassword = input.temporaryPassword?.trim() || generateTemporaryPassword();
    const requiredActions = ["UPDATE_PASSWORD"];
    if (rolesRequireMfa(roles)) {
      requiredActions.push("CONFIGURE_TOTP");
    }

    const token = await adminToken();
    const createRes = await fetch(`${config.baseUrl}/admin/realms/${REALM}/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username,
        enabled: true,
        email: input.email?.trim() || undefined,
        firstName: input.displayName.trim().slice(0, 80),
        requiredActions,
        credentials: [
          { type: "password", value: provisionalPassword, temporary: true },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // 409 = raced create; fall through to lookup.
    if (![201, 204, 409].includes(createRes.status)) {
      throw new KeycloakAdminError(
        "KEYCLOAK_USER_CREATE_FAILED",
        `Keycloak user create failed (${createRes.status})`,
        createRes.status >= 500 ? 503 : 502,
      );
    }

    let userId: string | null = null;
    const location = createRes.headers.get("location");
    if (location) userId = location.split("/").pop() || null;
    if (!userId) {
      const again = await findUserByUsername(username);
      userId = again?.id ?? null;
    }
    if (!userId) {
      throw new KeycloakAdminError("KEYCLOAK_USER_CREATE_FAILED", "Keycloak user create failed", 502);
    }
    // Conflict path: user already existed — do not return a password we did not set.
    if (createRes.status === 409) {
      await replaceRealmRoles(userId, roles);
      return { keycloakSub: userId, created: false };
    }

    await replaceRealmRoles(userId, roles);
    return {
      keycloakSub: userId,
      created: true,
      provisionalPassword,
    };
  }

  return {
    findUserByUsername,
    findUserById,
    provisionUser,
    replaceRealmRoles,
    setEnabled,
  };
}

export type KeycloakAdminClient = ReturnType<typeof createKeycloakAdminClient>;
