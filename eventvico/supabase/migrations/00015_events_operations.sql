-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 00015_events_operations
-- Description: Story 7.1–7.4 event metadata, recipe links, and fulfillment rows
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_metadata (
  event_id UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  venue TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'in_progress', 'fulfillment_complete', 'completed', 'cancelled')),
  google_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  google_sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_metadata_tenant_status_idx
  ON event_metadata (tenant_id, status);

ALTER TABLE event_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_metadata: read own tenant" ON event_metadata
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "event_metadata: insert own tenant" ON event_metadata
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "event_metadata: update own tenant" ON event_metadata
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "event_metadata: delete own tenant" ON event_metadata
  FOR DELETE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

DROP TRIGGER IF EXISTS event_metadata_updated_at ON event_metadata;
CREATE TRIGGER event_metadata_updated_at
  BEFORE UPDATE ON event_metadata
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS event_recipe_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, recipe_id)
);

CREATE INDEX IF NOT EXISTS event_recipe_links_tenant_event_idx
  ON event_recipe_links (tenant_id, event_id);

ALTER TABLE event_recipe_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_recipe_links: read own tenant" ON event_recipe_links
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "event_recipe_links: insert own tenant" ON event_recipe_links
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "event_recipe_links: update own tenant" ON event_recipe_links
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "event_recipe_links: delete own tenant" ON event_recipe_links
  FOR DELETE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE TABLE IF NOT EXISTS event_fulfillment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  arrangement_name TEXT NOT NULL,
  item_name TEXT NOT NULL,
  quantity_required NUMERIC(12, 2) NOT NULL DEFAULT 1 CHECK (quantity_required > 0),
  status TEXT NOT NULL DEFAULT 'unprepared'
    CHECK (status IN ('unprepared', 'prepared', 'packed', 'delivered')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_fulfillment_items_tenant_event_idx
  ON event_fulfillment_items (tenant_id, event_id, status);

ALTER TABLE event_fulfillment_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_fulfillment_items: read own tenant" ON event_fulfillment_items
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "event_fulfillment_items: insert own tenant" ON event_fulfillment_items
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "event_fulfillment_items: update own tenant" ON event_fulfillment_items
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "event_fulfillment_items: delete own tenant" ON event_fulfillment_items
  FOR DELETE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

DROP TRIGGER IF EXISTS event_fulfillment_items_updated_at ON event_fulfillment_items;
CREATE TRIGGER event_fulfillment_items_updated_at
  BEFORE UPDATE ON event_fulfillment_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
