-- ADR 0018: multi job-role membership
-- Drop legacy single-role CHECK before rewriting denormalized role values.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'system'
    AND rel.relname = 'membership'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%role%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE system.membership DROP CONSTRAINT %I', cname);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "system"."membership_role" (
    "membership_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    CONSTRAINT "membership_role_pkey" PRIMARY KEY ("membership_id", "role"),
    CONSTRAINT "membership_role_membership_id_fkey"
      FOREIGN KEY ("membership_id") REFERENCES "system"."membership"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "membership_role_role_check" CHECK (
      "role" IN (
        'administrator',
        'catalog_manager',
        'inventory_clerk',
        'sales_clerk',
        'stocktake_clerk',
        'issue_approver',
        'quality_officer',
        'auditor'
      )
    )
);

CREATE INDEX IF NOT EXISTS "membership_role_role_idx" ON "system"."membership_role" ("role");

-- Backfill from legacy single role
INSERT INTO "system"."membership_role" ("membership_id", "role")
SELECT m."id", 'administrator'
FROM "system"."membership" m
WHERE m."role" = 'administrator'
ON CONFLICT DO NOTHING;

INSERT INTO "system"."membership_role" ("membership_id", "role")
SELECT m."id", v.role
FROM "system"."membership" m
CROSS JOIN (VALUES
  ('catalog_manager'),
  ('inventory_clerk'),
  ('sales_clerk'),
  ('stocktake_clerk')
) AS v(role)
WHERE m."role" = 'staff'
ON CONFLICT DO NOTHING;

INSERT INTO "system"."membership_role" ("membership_id", "role")
SELECT m."id", v.role
FROM "system"."membership" m
CROSS JOIN (VALUES
  ('issue_approver'),
  ('auditor')
) AS v(role)
WHERE m."role" = 'approver'
ON CONFLICT DO NOTHING;

INSERT INTO "system"."membership_role" ("membership_id", "role")
SELECT m."id", 'auditor'
FROM "system"."membership" m
WHERE m."role" = 'viewer'
ON CONFLICT DO NOTHING;

-- Already-migrated rows that already use new codes
INSERT INTO "system"."membership_role" ("membership_id", "role")
SELECT m."id", m."role"
FROM "system"."membership" m
WHERE m."role" IN (
  'administrator',
  'catalog_manager',
  'inventory_clerk',
  'sales_clerk',
  'stocktake_clerk',
  'issue_approver',
  'quality_officer',
  'auditor'
)
ON CONFLICT DO NOTHING;

-- Rewrite denormalized primary role (legacy CHECK already dropped)
UPDATE "system"."membership" m
SET "role" = CASE m."role"
  WHEN 'staff' THEN 'catalog_manager'
  WHEN 'approver' THEN 'issue_approver'
  WHEN 'viewer' THEN 'auditor'
  ELSE m."role"
END
WHERE m."role" IN ('staff', 'approver', 'viewer');

ALTER TABLE "system"."membership"
  DROP CONSTRAINT IF EXISTS "membership_role_primary_check";

ALTER TABLE "system"."membership"
  ADD CONSTRAINT "membership_role_primary_check" CHECK (
    "role" IN (
      'administrator',
      'catalog_manager',
      'inventory_clerk',
      'sales_clerk',
      'stocktake_clerk',
      'issue_approver',
      'quality_officer',
      'auditor'
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "system"."membership_role" TO app_runtime;
  END IF;
END $$;
