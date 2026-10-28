-- Interface preferences and configured model services.
--
-- One settings row, pinned to the identifier 'default': the application reads
-- a single value, and a second row would create two truths. The preferences
-- themselves are a versioned JSON envelope, so a preference added later needs
-- no migration.
--
-- Version 1 already created a `provider_config` table of its own — with
-- provider_id, a nullable base_url, and none of name, kind or created_at —
-- and an upgraded database has it whether or not the old application ever
-- wrote into it. Creating the v2 table beside it fails with "table
-- provider_config already exists", which rolls this whole version back and
-- leaves the database without app_settings, so the legacy table is dropped
-- first. A fresh install reaches the same statement, because version 1 has
-- just created the legacy table.
--
-- The legacy rows are not converted: v1 kept provider configuration in
-- localStorage rather than in this table, and the v2 shape has no field those
-- columns could fill. The file copied before migration
-- (`re-resume.pre-v2.db`) holds the original. Version 6 removes the remaining
-- v1 tables; it must leave the v2 `provider_config` created below alone.
--
-- No database recorded version 2 as applied, because it failed on every
-- database it ran against and rolled itself back, so the file can be corrected
-- in place rather than superseded by a later version.

DROP TABLE IF EXISTS provider_config;

CREATE TABLE app_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE provider_config (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('openai-compatible', 'anthropic')),
  base_url TEXT NOT NULL,
  model_id TEXT NOT NULL,
  secret_ref TEXT NOT NULL,
  supports_images INTEGER CHECK (supports_images IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- At most one provider is active; the partial index is what enforces it, so a
-- second claim fails instead of silently changing which model runs.
CREATE UNIQUE INDEX idx_provider_active ON provider_config (is_active) WHERE is_active = 1;
