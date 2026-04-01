-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 00008_inventory_item_barcodes
-- Description: Story 3.4 barcode/QR linking support for inventory items
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS barcode_value TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_tenant_barcode_unique_idx
  ON inventory_items(tenant_id, barcode_value)
  WHERE barcode_value IS NOT NULL;
