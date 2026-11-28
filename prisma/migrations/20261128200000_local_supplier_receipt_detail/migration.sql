-- SPDX-License-Identifier: AGPL-3.0-only
-- ADR 0020: local supplier master + goods_receipt receipt_detail
BEGIN;

CREATE TABLE catalog.local_supplier (
  id uuid PRIMARY KEY,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  code text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  contact_phone text,
  contact_email text,
  note text,
  created_by_sub text NOT NULL,
  CONSTRAINT uq_local_supplier_code UNIQUE (code),
  CONSTRAINT ck_local_supplier_code_len CHECK (length(trim(code)) BETWEEN 1 AND 64),
  CONSTRAINT ck_local_supplier_name_len CHECK (length(trim(display_name)) BETWEEN 1 AND 200)
);

CREATE INDEX idx_local_supplier_status_name ON catalog.local_supplier(status, display_name);

CREATE TABLE trading.receipt_detail (
  document_id uuid PRIMARY KEY REFERENCES trading.document(id) ON DELETE RESTRICT,
  local_supplier_id uuid REFERENCES catalog.local_supplier(id) ON DELETE RESTRICT
);

CREATE INDEX idx_receipt_detail_supplier ON trading.receipt_detail(local_supplier_id);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON catalog.local_supplier TO app_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON trading.receipt_detail TO app_runtime;
  END IF;
END $$;

COMMIT;
