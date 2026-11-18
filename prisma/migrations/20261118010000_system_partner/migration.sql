-- SPDX-License-Identifier: AGPL-3.0-only
-- Migration: 20261118010000_system_partner
-- Adds system.partner and system.partner_connection tables.
-- Pulled forward from P05 into P02-T04 per decision-log (D14 M2M identity gate).
-- Ref: database-schema-v1.md § system.partner, system.partner_connection

-- Partner: one row per remote Nexora instance that this instance federates with.
CREATE TABLE system.partner (
    id                  uuid          NOT NULL,
    created_at          timestamptz   NOT NULL DEFAULT now(),
    updated_at          timestamptz   NOT NULL DEFAULT now(),
    version             integer       NOT NULL DEFAULT 1 CHECK (version > 0),
    issuer_instance_id  text          NOT NULL,
    code                text          NOT NULL CHECK (length(trim(code)) BETWEEN 1 AND 40),
    display_name        text          NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 200),
    status              text          NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    contact_email       text,
    created_by_sub      text          NOT NULL,
    CONSTRAINT partner_pkey PRIMARY KEY (id),
    CONSTRAINT partner_issuer_instance_id_key UNIQUE (issuer_instance_id),
    CONSTRAINT partner_code_key UNIQUE (code)
);

-- PartnerConnection: credentials and routing for each federated partner.
-- Secret references use a secret-store key name, never the plaintext secret.
-- HTTPS + host allowlist enforced at application layer (platform/security/ssrf.ts).
CREATE TABLE system.partner_connection (
    id                      uuid          NOT NULL,
    created_at              timestamptz   NOT NULL DEFAULT now(),
    updated_at              timestamptz   NOT NULL DEFAULT now(),
    version                 integer       NOT NULL DEFAULT 1 CHECK (version > 0),
    partner_id              uuid          NOT NULL,
    endpoint_url            text          NOT NULL,
    outbound_token_url      text          NOT NULL,
    outbound_client_id      text          NOT NULL,
    outbound_secret_ref     text          NOT NULL,
    outbound_audience       text          NOT NULL,
    inbound_client_id       text          NOT NULL,
    allowed_inbound_scope   text          NOT NULL DEFAULT 'federation:write',
    status                  text          NOT NULL DEFAULT 'active' CHECK (status IN ('active','rotating','disabled')),
    last_verified_at        timestamptz,
    rotated_at              timestamptz,
    CONSTRAINT partner_connection_pkey PRIMARY KEY (id),
    CONSTRAINT partner_connection_partner_id_key UNIQUE (partner_id),
    CONSTRAINT partner_connection_inbound_client_id_key UNIQUE (inbound_client_id),
    CONSTRAINT partner_connection_partner_id_fkey
        FOREIGN KEY (partner_id) REFERENCES system.partner(id) ON DELETE RESTRICT
);
