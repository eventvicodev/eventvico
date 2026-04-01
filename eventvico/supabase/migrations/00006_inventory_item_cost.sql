-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 00006_inventory_item_cost
-- Description: Story 3.2 add unit cost column for inventory CRUD
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS cost NUMERIC(12, 2) NOT NULL DEFAULT 0
  CHECK (cost >= 0);
