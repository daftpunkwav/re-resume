-- Information library: custom module definitions, their entries, and the
-- append-only change log that makes every library write reversible.
--
-- Why these three tables share one migration version: the change log is the
-- transaction partner of every library write (spec sections 4.10 and 8.6), so a
-- migration that created the entities without the log could not record a single
-- reversible write. The table accepts the jobPosting scope as well; the library
-- use cases write the library scope.
--
-- Why custom_module.name is case-insensitively unique: the library rule says a
-- module name is unique regardless of case. SQLite's default BINARY collation
-- would accept "Work" and "work" as different names, so the collation is part of
-- the declared constraint rather than left to the use case alone.
--
-- Why info_entry.custom_module_id is an FK with CASCADE: the module owns its
-- entries, and the delete use case confirms the cascade before it runs. The
-- resume side deliberately has no foreign key to info_entry (spec section 8.2),
-- so deleting an entry cannot silently rewrite a resume.
--
-- Why the order index uses IFNULL: SQLite treats NULL values as distinct in a
-- unique index, so a plain (module_kind, custom_module_id, sort_order) index
-- would allow two built-in entries to share one sort order.

CREATE TABLE custom_module (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (name COLLATE NOCASE),
  UNIQUE (sort_order)
);

CREATE TABLE info_entry (
  id TEXT PRIMARY KEY,
  module_kind TEXT NOT NULL CHECK (module_kind IN ('personal', 'education', 'internship',
    'project', 'skill', 'award', 'jobIntent', 'selfEvaluation', 'custom')),
  custom_module_id TEXT REFERENCES custom_module (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 1),
  origin TEXT NOT NULL CHECK (origin IN ('user', 'agent')),
  -- Provenance column without a foreign key: agent_run is not part of this
  -- schema version (spec section 8.2).
  source_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((module_kind = 'custom') = (custom_module_id IS NOT NULL))
);

CREATE UNIQUE INDEX idx_info_entry_order
  ON info_entry (module_kind, IFNULL(custom_module_id, ''), sort_order);
CREATE INDEX idx_info_entry_module ON info_entry (module_kind, custom_module_id);
CREATE INDEX idx_info_entry_title ON info_entry (title);

CREATE TABLE change_record (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('library', 'jobPosting')),
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  -- The operation is a closed set enforced by the domain type; a CHECK here
  -- would need a DDL change for every new operation of an existing scope.
  op TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('user', 'agent')),
  -- Cross-domain provenance columns without foreign keys (spec section 8.2).
  run_id TEXT,
  conversation_id TEXT,
  label TEXT NOT NULL,
  undone_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_change_entity ON change_record (entity, entity_id, created_at DESC);
