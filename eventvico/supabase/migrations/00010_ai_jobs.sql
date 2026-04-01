-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 00010_ai_jobs
-- Description: Story 4.2 AI generation job queue foundation
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK (source_type IN ('image', 'pinterest_url')),
  source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  result_payload JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_jobs_tenant_created_at_idx
  ON ai_jobs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_jobs_tenant_status_idx
  ON ai_jobs (tenant_id, status);

ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_jobs: read own tenant" ON ai_jobs
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "ai_jobs: insert own tenant" ON ai_jobs
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND created_by = auth.uid()
  );

CREATE POLICY "ai_jobs: update own tenant" ON ai_jobs
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

DROP TRIGGER IF EXISTS ai_jobs_updated_at ON ai_jobs;
CREATE TRIGGER ai_jobs_updated_at
  BEFORE UPDATE ON ai_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
