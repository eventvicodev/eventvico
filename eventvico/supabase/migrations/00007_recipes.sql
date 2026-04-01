-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 00007_recipes
-- Description: Story 4.1 recipe and recipe item foundation
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  event_type TEXT,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recipes_tenant_id_idx ON recipes(tenant_id);
CREATE INDEX IF NOT EXISTS recipes_tenant_created_at_idx ON recipes(tenant_id, created_at DESC);

ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipes: read own tenant" ON recipes
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "recipes: insert own tenant" ON recipes
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND created_by = auth.uid()
  );

CREATE POLICY "recipes: update own tenant" ON recipes
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "recipes: delete own tenant" ON recipes
  FOR DELETE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

DROP TRIGGER IF EXISTS recipes_updated_at ON recipes;
CREATE TRIGGER recipes_updated_at
  BEFORE UPDATE ON recipes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS recipe_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  stem_count INT NOT NULL DEFAULT 1 CHECK (stem_count > 0),
  quantity NUMERIC(12, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, inventory_item_id)
);

CREATE INDEX IF NOT EXISTS recipe_items_tenant_recipe_idx ON recipe_items(tenant_id, recipe_id);

ALTER TABLE recipe_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipe_items: read own tenant" ON recipe_items
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "recipe_items: insert own tenant" ON recipe_items
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "recipe_items: update own tenant" ON recipe_items
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "recipe_items: delete own tenant" ON recipe_items
  FOR DELETE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

DROP TRIGGER IF EXISTS recipe_items_updated_at ON recipe_items;
CREATE TRIGGER recipe_items_updated_at
  BEFORE UPDATE ON recipe_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
