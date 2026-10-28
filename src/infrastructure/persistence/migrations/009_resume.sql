-- Resume document schema: one resume row, its revision chain (which doubles as
-- undo/redo history and change record) and its frozen snapshots.
--
-- Why the v1 tables are dropped first: version 1 created `resume`,
-- `resume_snapshot` and `document_revision` with a different shape (single
-- `page_setup_json` / `blocks_json`, no target job envelope). Creating the v2
-- tables beside them fails with "table resume already exists" and rolls this
-- whole version back. The drops follow foreign-key order: the revision table is
-- a child of `resume`, the snapshot table is a child of `resume`, and
-- `document_revision` is dropped defensively because version 8 already removed
-- it while clearing the v1 same-name tables.
--
-- Why the v1 rows are not converted: a v1 document is a list of blocks that
-- reference `experience` and `variant` rows; v2 composes `info_entry` values and
-- has no counterpart for a Variant or a Claim, so any mapping would have to
-- invent content. The migration is a rebuild, not a data migration. The copy the
-- native shell makes before the first migration (`re-resume.pre-v2.db` in the
-- application config directory) keeps the old data readable.
--
-- Why these table names are the v2 truth: `resume`, `resume_revision` and
-- `resume_snapshot` below carry every resume this build knows; dropping any of
-- them loses the document and its history.
--
-- Why `current_revision_id` and `conversation_id` carry no foreign key:
-- `resume` and its first revision reference each other, so one side of the pair
-- cannot be enforced at insert time; the repository's transaction is what makes
-- the pointer consistent. The conversation belongs to another migration version
-- (spec section 8.2), so it is a bare text column.

DROP TABLE IF EXISTS document_revision;
DROP TABLE IF EXISTS resume_snapshot;
DROP TABLE IF EXISTS resume;

CREATE TABLE resume (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  target_job_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'frozen')),
  current_revision_id TEXT NOT NULL,
  conversation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_resume_status ON resume (status);

CREATE TABLE resume_revision (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL REFERENCES resume (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  label TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('user', 'agent')),
  run_id TEXT,
  state_json TEXT NOT NULL,
  superseded_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (resume_id, seq)
);

CREATE INDEX idx_revision_resume ON resume_revision (resume_id, seq);

CREATE TABLE resume_snapshot (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL REFERENCES resume (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  frozen_state_json TEXT NOT NULL,
  materialized_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (resume_id, seq)
);
