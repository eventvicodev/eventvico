-- Dev seed data — only applied in local development, not production
-- Run: supabase db reset (applies migrations + seed)

-- Insert a dev tenant
INSERT INTO tenants (id, name, plan_status, trial_ends_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Demo Studio',
  'trial',
  now() + interval '14 days'
) ON CONFLICT DO NOTHING;

-- Note: profiles are inserted via Supabase Auth trigger in Story 1.2
-- (auto-create profile on auth.users insert)
