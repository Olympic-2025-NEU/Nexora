-- SPDX-License-Identifier: AGPL-3.0-only
-- P02-T01: system schema — organization singleton + membership identity core.
-- Ref: documents/phase-plan/database-schema-v1.md § P05 system.organization / system.membership
BEGIN;

CREATE SCHEMA IF NOT EXISTS "system";

-- ---------------------------------------------------------------------------
-- system.organization  (singleton: exactly one row per DB instance)
-- ---------------------------------------------------------------------------
CREATE TABLE "system"."organization" (
    "id"              UUID        NOT NULL,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version"         INTEGER     NOT NULL DEFAULT 1,
    "singleton_slot"  SMALLINT    NOT NULL DEFAULT 1,
    "instance_id"     TEXT        NOT NULL,
    "code"            TEXT        NOT NULL,
    "name"            TEXT        NOT NULL,
    "contact_email"   TEXT,
    "timezone"        TEXT        NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "status"          TEXT        NOT NULL DEFAULT 'active',
    CONSTRAINT "organization_pkey"             PRIMARY KEY ("id"),
    CONSTRAINT "organization_singleton"        UNIQUE ("singleton_slot"),
    CONSTRAINT "organization_instance_id_key"  UNIQUE ("instance_id"),
    CONSTRAINT "organization_code_key"         UNIQUE ("code"),
    CONSTRAINT "organization_slot_check"       CHECK ("singleton_slot" = 1),
    CONSTRAINT "organization_version_check"    CHECK ("version" > 0),
    CONSTRAINT "organization_code_len"         CHECK (length(trim("code"))  BETWEEN 1 AND 40),
    CONSTRAINT "organization_name_len"         CHECK (length(trim("name"))  BETWEEN 1 AND 200),
    CONSTRAINT "organization_status_check"     CHECK ("status" IN ('active', 'suspended'))
);

-- ---------------------------------------------------------------------------
-- system.membership  (one primary role per Keycloak sub)
-- ---------------------------------------------------------------------------
CREATE TABLE "system"."membership" (
    "id"               UUID        NOT NULL,
    "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version"          INTEGER     NOT NULL DEFAULT 1,
    "organization_id"  UUID        NOT NULL,
    "keycloak_sub"     TEXT        NOT NULL,
    "display_name"     TEXT        NOT NULL,
    "email"            TEXT,
    "role"             TEXT        NOT NULL,
    "status"           TEXT        NOT NULL DEFAULT 'invited',
    "last_synced_at"   TIMESTAMPTZ(6),
    CONSTRAINT "membership_pkey"              PRIMARY KEY ("id"),
    CONSTRAINT "membership_sub_key"           UNIQUE ("keycloak_sub"),
    CONSTRAINT "membership_org_fk"            FOREIGN KEY ("organization_id")
                                              REFERENCES "system"."organization" ("id")
                                              ON DELETE RESTRICT,
    CONSTRAINT "membership_version_check"     CHECK ("version" > 0),
    CONSTRAINT "membership_display_name_len"  CHECK (length(trim("display_name")) BETWEEN 1 AND 160),
    CONSTRAINT "membership_role_check"        CHECK ("role" IN ('administrator', 'staff', 'approver', 'viewer')),
    CONSTRAINT "membership_status_check"      CHECK ("status" IN ('invited', 'active', 'disabled'))
);

CREATE INDEX "membership_role_status_idx" ON "system"."membership" ("role", "status");

-- ---------------------------------------------------------------------------
-- Grants (roles may not exist in test env — wrapped in DO block)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
        GRANT USAGE ON SCHEMA "system" TO app_runtime;
        GRANT SELECT ON "system"."organization" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE ON "system"."membership" TO app_runtime;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'core_data') THEN
        GRANT USAGE ON SCHEMA "system" TO core_data;
        GRANT SELECT, INSERT, UPDATE ON "system"."organization", "system"."membership" TO core_data;
    END IF;
END
$$;

COMMIT;
