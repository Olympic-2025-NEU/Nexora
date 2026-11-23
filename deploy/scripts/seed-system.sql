INSERT INTO system.organization (
  id, created_at, updated_at, version, singleton_slot, instance_id, code, name, timezone, status
) VALUES (
  gen_random_uuid(), now(), now(), 1, 1, 'nexora-a', 'ORG-A', 'Nexora Org ORG-A', 'Asia/Ho_Chi_Minh', 'active'
) ON CONFLICT (singleton_slot) DO NOTHING;

INSERT INTO system.membership (
  id, created_at, updated_at, version, organization_id, keycloak_sub, display_name, role, status, last_synced_at
)
SELECT gen_random_uuid(), now(), now(), 1, o.id, :'sub', 'dev-staff', 'staff', 'active', now()
FROM system.organization o
WHERE o.singleton_slot = 1
ON CONFLICT (keycloak_sub) DO UPDATE
  SET status = 'active', role = 'staff', updated_at = now(), last_synced_at = now();
