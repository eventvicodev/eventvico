-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 00002_trial_access_and_reminders
-- Description: Enforce 14-day trial defaults and add transactional email outbox
-- ─────────────────────────────────────────────────────────────────────────────

-- Ensure trial window is always initialized for tenants
ALTER TABLE tenants
  ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '14 days');

UPDATE tenants
SET trial_ends_at = COALESCE(trial_ends_at, created_at + interval '14 days')
WHERE trial_ends_at IS NULL;

-- Keep signup bootstrap trigger aligned with trial defaults
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_tenant_id UUID;
  studio_name TEXT;
BEGIN
  studio_name := COALESCE(NULLIF(NEW.raw_user_meta_data->>'studio_name', ''), 'My Studio');

  INSERT INTO public.tenants (name, plan_status, trial_ends_at)
  VALUES (studio_name, 'trial', now() + interval '14 days')
  RETURNING id INTO new_tenant_id;

  INSERT INTO public.profiles (id, tenant_id, role, full_name, avatar_url)
  VALUES (
    NEW.id,
    new_tenant_id,
    'owner',
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'avatar_url', '')
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Simple outbox for transactional emails with idempotency key
CREATE TABLE IF NOT EXISTS email_outbox (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_outbox: insert service role" ON email_outbox
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "email_outbox: insert own tenant" ON email_outbox
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );
