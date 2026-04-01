-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 00011_inventory_item_unavailability
-- Description: Story 4.5 unavailable item flag for substitution workflows
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS is_unavailable BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS inventory_items_tenant_unavailable_idx
  ON inventory_items (tenant_id, is_unavailable);
