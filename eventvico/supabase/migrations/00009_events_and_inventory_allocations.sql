-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 00009_events_and_inventory_allocations
-- Description: Story 3.6 event and inventory allocation foundation
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_tenant_id_idx ON events(tenant_id);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events: read own tenant" ON events
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "events: insert own tenant" ON events
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND created_by = auth.uid()
  );

CREATE POLICY "events: update own tenant" ON events
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "events: delete own tenant" ON events
  FOR DELETE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

DROP TRIGGER IF EXISTS events_updated_at ON events;
CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS inventory_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  quantity_committed NUMERIC(12, 2) NOT NULL CHECK (quantity_committed > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (inventory_item_id, event_id)
);

CREATE INDEX IF NOT EXISTS inventory_allocations_tenant_item_idx
  ON inventory_allocations(tenant_id, inventory_item_id);

ALTER TABLE inventory_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_allocations: read own tenant" ON inventory_allocations
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "inventory_allocations: insert own tenant" ON inventory_allocations
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "inventory_allocations: update own tenant" ON inventory_allocations
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "inventory_allocations: delete own tenant" ON inventory_allocations
  FOR DELETE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

DROP TRIGGER IF EXISTS inventory_allocations_updated_at ON inventory_allocations;
CREATE TRIGGER inventory_allocations_updated_at
  BEFORE UPDATE ON inventory_allocations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
