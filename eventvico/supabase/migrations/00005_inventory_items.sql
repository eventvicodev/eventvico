-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 00005_inventory_items
-- Description: Story 3.1 inventory items table + RLS policies
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  category TEXT NOT NULL
    CHECK (category IN ('flowers', 'decor', 'consumables')),
  unit TEXT NOT NULL,
  quantity_on_hand NUMERIC(12, 2) NOT NULL DEFAULT 0
    CHECK (quantity_on_hand >= 0),
  sku TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku)
);

CREATE INDEX IF NOT EXISTS inventory_items_tenant_id_idx ON inventory_items(tenant_id);
CREATE INDEX IF NOT EXISTS inventory_items_tenant_category_idx ON inventory_items(tenant_id, category);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_items: read own tenant" ON inventory_items
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "inventory_items: insert own tenant" ON inventory_items
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND created_by = auth.uid()
  );

CREATE POLICY "inventory_items: update own tenant" ON inventory_items
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "inventory_items: delete own tenant" ON inventory_items
  FOR DELETE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

DROP TRIGGER IF EXISTS inventory_items_updated_at ON inventory_items;
CREATE TRIGGER inventory_items_updated_at
  BEFORE UPDATE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
