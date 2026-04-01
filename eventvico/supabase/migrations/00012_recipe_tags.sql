-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 00012_recipe_tags
-- Description: Story 4.6 recipe organization metadata
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS recipe_tags TEXT[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS recipes_recipe_tags_gin_idx
  ON recipes
  USING GIN (recipe_tags);
