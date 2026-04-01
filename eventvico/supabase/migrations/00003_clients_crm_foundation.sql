-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 00003_clients_crm_foundation
-- Description: Story 2.1 client registration table + RLS policies
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  event_date DATE,
  venue TEXT,
  guest_count INT CHECK (guest_count IS NULL OR guest_count >= 0),
  budget NUMERIC(12, 2) CHECK (budget IS NULL OR budget >= 0),
  pipeline_stage TEXT NOT NULL DEFAULT 'lead'
    CHECK (
      pipeline_stage IN (
        'lead',
        'qualified',
        'proposal_sent',
        'revision',
        'booked',
        'in_fulfillment',
        'completed'
      )
    ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clients_tenant_id_idx ON clients(tenant_id);
CREATE INDEX IF NOT EXISTS clients_tenant_stage_idx ON clients(tenant_id, pipeline_stage);
CREATE INDEX IF NOT EXISTS clients_tenant_email_idx ON clients(tenant_id, email);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients: read own tenant" ON clients
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "clients: insert own tenant" ON clients
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND created_by = auth.uid()
  );

CREATE POLICY "clients: update own tenant" ON clients
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "clients: delete own tenant" ON clients
  FOR DELETE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

DROP TRIGGER IF EXISTS clients_updated_at ON clients;
CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
