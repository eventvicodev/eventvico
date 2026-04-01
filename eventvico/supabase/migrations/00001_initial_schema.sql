-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 00001_initial_schema
-- Description: Core tenant + profiles tables with RLS
-- Note: Only creates tables needed by Story 1.x (auth/tenancy).
--       All other tables are created in the stories that first need them.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── tenants ──────────────────────────────────────────────────────────────────
-- One row per studio. All other tables reference tenant_id from here.
CREATE TABLE tenants (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  slug        TEXT        UNIQUE,  -- optional vanity slug
  plan_status TEXT        NOT NULL DEFAULT 'trial'
                          CHECK (plan_status IN ('trial', 'active', 'past_due', 'cancelled')),
  trial_ends_at TIMESTAMPTZ,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  lock_window_days INT NOT NULL DEFAULT 10,  -- FR36: configurable lock window
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row-Level Security
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- ── profiles ─────────────────────────────────────────────────────────────────
-- Links auth.users to tenants. One profile per auth user.
CREATE TABLE profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL REFERENCES tenants ON DELETE CASCADE,
  role        TEXT        NOT NULL DEFAULT 'member'
                          CHECK (role IN ('owner', 'admin', 'member')),
  full_name   TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row-Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies ──────────────────────────────────────────────────────────────

-- Tenants: studio users can only see their own tenant
CREATE POLICY "tenants: read own" ON tenants
  FOR SELECT USING (
    id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "tenants: update own" ON tenants
  FOR UPDATE USING (
    id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

-- Profiles: users can see profiles within their tenant
-- Also allow reading their own profile row to avoid bootstrapping issues.
CREATE POLICY "profiles: read own tenant" ON profiles
  FOR SELECT USING (
    id = auth.uid()
    OR
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

-- Profiles inserts should be controlled (created on signup via trigger, or by service role).
CREATE POLICY "profiles: insert service role" ON profiles
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "profiles: update own" ON profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ── Trigger: auto-update updated_at ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Trigger: prevent tenant_id / role escalation ─────────────────────────────
CREATE OR REPLACE FUNCTION prevent_profile_privilege_escalation()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.role() = 'authenticated' AND (NEW.tenant_id <> OLD.tenant_id OR NEW.role <> OLD.role) THEN
    RAISE EXCEPTION 'Updating tenant_id/role is not permitted';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_prevent_privilege_escalation
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_profile_privilege_escalation();

-- ── Trigger: create tenant + profile on signup ───────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_tenant_id UUID;
  studio_name TEXT;
BEGIN
  studio_name := COALESCE(NULLIF(NEW.raw_user_meta_data->>'studio_name', ''), 'My Studio');

  INSERT INTO public.tenants (name)
  VALUES (studio_name)
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
