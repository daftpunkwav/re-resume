-- No app-level schema_version table: migration bookkeeping is owned by the
-- SQL plugin's built-in migration mechanism (section 6.2). A local table
-- would duplicate that ledger and allow multiple rows, since it has no
-- single-row constraint.

-- Singleton: exactly one row, seeded below; UpdateProfile is the only
-- mutation path. The seed makes ProfileRepository.get() a total function —
-- without it the first agent draft on a fresh install would read an empty
-- table.
CREATE TABLE profile (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  -- ProfileLink[] in the envelope; the default is itself a valid envelope,
  -- not a bare value — a bare '{}' would be rejected at read time.
  links_json    TEXT NOT NULL DEFAULT '{"v":1,"data":[]}',
  version       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL
);

-- Seed row: display_name stays empty until the user sets up their profile;
-- updated_at takes the migration-run clock.
INSERT INTO profile (id, display_name, links_json, version, updated_at)
VALUES ('default', '', '{"v":1,"data":[]}', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE experience (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('education','internship','work','project','award','skill','summary')),
  title          TEXT NOT NULL,
  organization   TEXT,
  start_date     TEXT,
  end_date       TEXT,
  is_current     INTEGER NOT NULL DEFAULT 0,
  detail_json    TEXT NOT NULL DEFAULT '{"v":1,"data":{}}',
  fact_version   INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_experience_kind ON experience (kind);

CREATE TABLE variant (
  id                TEXT PRIMARY KEY,
  experience_id     TEXT NOT NULL REFERENCES experience (id) ON DELETE CASCADE,
  label             TEXT NOT NULL,
  content           TEXT NOT NULL,
  emphasis          TEXT,
  -- Provenance is kept after confirmation; "unconfirmed draft" is derived:
  -- drafted_by_run_id IS NOT NULL AND confirmed_at IS NULL.
  -- FKs referencing agent_run are all RESTRICT: runs carry the PRD 4.6
  -- provenance and must not vanish via SET NULL; v1 has no run deletion.
  drafted_by_run_id TEXT REFERENCES agent_run (id) ON DELETE RESTRICT,
  confirmed_at      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (experience_id, label)
);

CREATE TABLE claim (
  id             TEXT PRIMARY KEY,
  experience_id  TEXT NOT NULL REFERENCES experience (id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('metric','responsibility','skill')),
  statement      TEXT NOT NULL,
  source_field   TEXT,
  status         TEXT NOT NULL CHECK (status IN ('confirmed','pending','rejected')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
-- Active statements are unique per experience; rejected rows do not hold the
-- key, so a rejected wording can be re-added as a new claim (section 3.4).
-- A plain UNIQUE (experience_id, statement) would make "reject old, add new"
-- fail on the very wording the user just rejected.
CREATE UNIQUE INDEX idx_claim_active_statement
  ON claim (experience_id, statement) WHERE status <> 'rejected';
CREATE INDEX idx_claim_status ON claim (status);

-- current_revision_id intentionally carries no FOREIGN KEY clause: the
-- resume row and its initial revision reference each other, and the insert
-- order would violate one side if both FKs were enforced. The pointer's
-- integrity ("must reference a revision of this resume") is a
-- ResumeRepository contract instead (section 4).
-- pageSetup lives in document_revision, not here: revisions snapshot the
-- full DocumentState, and a second copy would be a dual source of truth.
CREATE TABLE resume (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  target_role         TEXT,
  status              TEXT NOT NULL CHECK (status IN ('draft','frozen')),
  current_revision_id TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- Doubles as the undo/redo chain and as the change record required by
-- PRD 4.6. seq is a per-resume monotonic history number, never reused;
-- superseded_at marks an abandoned undo branch (section 3.6).
CREATE TABLE document_revision (
  id              TEXT PRIMARY KEY,
  resume_id       TEXT NOT NULL REFERENCES resume (id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  label           TEXT NOT NULL,
  origin          TEXT NOT NULL CHECK (origin IN ('user','agent')),
  run_id          TEXT REFERENCES agent_run (id) ON DELETE RESTRICT,
  blocks_json     TEXT NOT NULL,
  page_setup_json TEXT NOT NULL,
  superseded_at   TEXT,
  created_at      TEXT NOT NULL,
  UNIQUE (resume_id, seq)
);

CREATE TABLE resume_snapshot (
  id                  TEXT PRIMARY KEY,
  resume_id           TEXT NOT NULL REFERENCES resume (id) ON DELETE CASCADE,
  seq                 INTEGER NOT NULL,
  materialized_json   TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  UNIQUE (resume_id, seq)
);

CREATE TABLE job_posting (
  id               TEXT PRIMARY KEY,
  raw_text         TEXT NOT NULL,
  source           TEXT,
  parsed_json      TEXT,
  -- Provenance of the parse: which agent run produced it, and when.
  parsed_by_run_id TEXT REFERENCES agent_run (id) ON DELETE RESTRICT,
  parsed_at        TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE agent_run (
  id              TEXT PRIMARY KEY,
  resume_id       TEXT REFERENCES resume (id) ON DELETE SET NULL,
  job_posting_id  TEXT REFERENCES job_posting (id) ON DELETE SET NULL,
  status          TEXT NOT NULL CHECK (status IN ('running','awaitingConfirmation','completed','failed','cancelled')),
  error_text      TEXT,
  started_at      TEXT NOT NULL,
  ended_at        TEXT
);

CREATE TABLE tool_invocation (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES agent_run (id) ON DELETE CASCADE,
  tool_name       TEXT NOT NULL,
  risk            TEXT NOT NULL CHECK (risk IN ('read','write','propose','destructive')),
  args_json       TEXT NOT NULL,
  result_json     TEXT,
  approval_state  TEXT NOT NULL CHECK (approval_state IN ('pending','approved','rejected','executed')),
  created_at      TEXT NOT NULL
);

-- Only the reference to the secret is stored here; the key itself lives in Stronghold.
CREATE TABLE provider_config (
  id           TEXT PRIMARY KEY,
  provider_id  TEXT NOT NULL,
  model_id     TEXT NOT NULL,
  base_url     TEXT,
  secret_ref   TEXT NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL
);
