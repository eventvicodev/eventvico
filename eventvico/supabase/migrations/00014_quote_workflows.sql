-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 00014_quote_workflows
-- Description: Story 5.2–5.7 quote customization/revision/audit/share workflows
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS note TEXT,
  ADD COLUMN IF NOT EXISTS discount_type TEXT CHECK (discount_type IN ('percent', 'fixed') OR discount_type IS NULL),
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS root_quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revision_number INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS quotes_root_quote_idx
  ON quotes (tenant_id, root_quote_id, revision_number DESC);

ALTER TABLE quote_line_items
  ADD COLUMN IF NOT EXISTS line_type TEXT NOT NULL DEFAULT 'inventory'
    CHECK (line_type IN ('inventory', 'custom', 'discount'));

CREATE TABLE IF NOT EXISTS quote_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  action_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_audit_logs_quote_idx
  ON quote_audit_logs (tenant_id, quote_id, created_at DESC);

ALTER TABLE quote_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quote_audit_logs: read own tenant" ON quote_audit_logs
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "quote_audit_logs: insert own tenant" ON quote_audit_logs
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE TABLE IF NOT EXISTS quote_share_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_share_tokens_token_idx
  ON quote_share_tokens (token);

CREATE INDEX IF NOT EXISTS quote_share_tokens_quote_idx
  ON quote_share_tokens (tenant_id, quote_id, created_at DESC);

ALTER TABLE quote_share_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quote_share_tokens: read own tenant" ON quote_share_tokens
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "quote_share_tokens: insert own tenant" ON quote_share_tokens
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );
