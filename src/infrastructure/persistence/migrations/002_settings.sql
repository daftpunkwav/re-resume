-- Interface preferences and configured model services.
--
-- One settings row, pinned to the identifier 'default': the application reads
-- a single value, and a second row would create two truths. The preferences
-- themselves are a versioned JSON envelope, so a preference added later needs
-- no migration.

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
