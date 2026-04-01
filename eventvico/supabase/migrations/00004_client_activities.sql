-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 00004_client_activities
-- Description: Story 2.3 activity logging against client records
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS client_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  logged_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  activity_type TEXT NOT NULL
    CHECK (activity_type IN ('call', 'meeting', 'note', 'task')),
  summary TEXT NOT NULL,
  note TEXT,
  due_at TIMESTAMPTZ,
  task_status TEXT NOT NULL DEFAULT 'open'
    CHECK (task_status IN ('open', 'completed')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_activities_client_created_idx
  ON client_activities (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS client_activities_tenant_due_idx
  ON client_activities (tenant_id, due_at)
  WHERE activity_type = 'task' AND task_status = 'open';

ALTER TABLE client_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_activities: read own tenant" ON client_activities
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "client_activities: insert own tenant" ON client_activities
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND logged_by = auth.uid()
  );

CREATE POLICY "client_activities: update own tenant" ON client_activities
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "client_activities: delete own tenant" ON client_activities
  FOR DELETE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

DROP TRIGGER IF EXISTS client_activities_updated_at ON client_activities;
CREATE TRIGGER client_activities_updated_at
  BEFORE UPDATE ON client_activities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
