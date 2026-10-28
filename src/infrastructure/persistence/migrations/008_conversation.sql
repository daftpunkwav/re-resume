-- Conversations, their messages and attachments, job postings, and the agent
-- runs that audit what the assistant did. Applied as migration version 8.
-- A migration file is immutable once it has been applied anywhere: this body
-- was registered as version 8 and must not change afterwards.
--
-- The v1 schema (version 1) already creates tables with four of these names and
-- wires them into a provenance chain that version 6 has not removed yet:
--   tool_invocation.run_id       -> agent_run     ON DELETE CASCADE
--   variant.drafted_by_run_id    -> agent_run     ON DELETE RESTRICT
--   document_revision.run_id     -> agent_run     ON DELETE RESTRICT
--   job_posting.parsed_by_run_id -> agent_run     ON DELETE RESTRICT
--   agent_run.resume_id          -> resume        ON DELETE SET NULL
--   agent_run.job_posting_id     -> job_posting   ON DELETE SET NULL
-- Recreating those names requires dropping the old tables first, and the
-- RESTRICT children have to go before agent_run: dropping agent_run performs an
-- implicit delete of its rows, which a RESTRICT child would abort. The legacy
-- rows are not converted — v1's claim/variant/run model has no v2 counterpart,
-- and the pre-migration database copy holds the original data.
--
-- Cross-domain references (a run's resume, a conversation's active resume, a
-- posting's conversation) are bare TEXT columns without foreign keys: the
-- migrations are owned by separate changes and a forward reference would make
-- an insert fail whenever the referenced table has not been created yet. Only
-- ownership inside this file is enforced with a foreign key.

DROP TABLE IF EXISTS tool_invocation;
DROP TABLE IF EXISTS variant;
DROP TABLE IF EXISTS claim;
DROP TABLE IF EXISTS document_revision;
DROP TABLE IF EXISTS job_posting;
DROP TABLE IF EXISTS agent_run;

CREATE TABLE conversation (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  active_resume_id TEXT,
  summary TEXT,
  summary_through_seq INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_conversation_order ON conversation (pinned DESC, updated_at DESC);

CREATE TABLE attachment (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'file')),
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  storage_name TEXT NOT NULL UNIQUE,
  width INTEGER,
  height INTEGER,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- One row per distinct byte sequence; ingesting the same file twice reuses it.
CREATE UNIQUE INDEX idx_attachment_sha ON attachment (sha256);

CREATE TABLE message (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversation (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('user', 'assistant', 'tool')),
  status TEXT NOT NULL CHECK (status IN ('streaming', 'complete', 'cancelled', 'failed', 'running')),
  markdown TEXT NOT NULL DEFAULT '',
  tool_json TEXT,
  run_id TEXT,
  error_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (conversation_id, seq),
  -- A tool card exists exactly for tool messages.
  CHECK ((kind = 'tool') = (tool_json IS NOT NULL))
);

CREATE INDEX idx_message_conversation ON message (conversation_id, seq);

CREATE TABLE message_attachment (
  message_id TEXT NOT NULL REFERENCES message (id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachment (id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  PRIMARY KEY (message_id, attachment_id)
);

CREATE TABLE message_context (
  message_id TEXT NOT NULL REFERENCES message (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('entry', 'resume', 'jobPosting')),
  ref_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (message_id, kind, ref_id)
);

CREATE TABLE job_posting (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL DEFAULT '',
  source TEXT,
  image_attachment_ids TEXT NOT NULL DEFAULT '{"v":1,"data":[]}',
  conversation_id TEXT,
  resume_id TEXT,
  parsed_json TEXT,
  parsed_by_run_id TEXT,
  parsed_at TEXT,
  created_at TEXT NOT NULL,
  -- A posting is something to read: text, images, or both.
  CHECK (raw_text <> '' OR image_attachment_ids <> '{"v":1,"data":[]}')
);

CREATE TABLE agent_run (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversation (id) ON DELETE SET NULL,
  resume_id TEXT,
  job_posting_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  error_text TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE INDEX idx_run_conversation ON agent_run (conversation_id, started_at DESC);

-- One run per conversation at a time. NULL conversation_id rows (a standalone
-- job-posting parse) do not participate: SQLite treats NULLs as distinct in a
-- unique index, which is exactly the wanted behaviour.
CREATE UNIQUE INDEX idx_run_one_running ON agent_run (conversation_id) WHERE status = 'running';

CREATE TABLE tool_invocation (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_run (id) ON DELETE CASCADE,
  message_id TEXT REFERENCES message (id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  risk TEXT NOT NULL CHECK (risk IN ('read', 'write', 'draft')),
  args_json TEXT NOT NULL,
  result_summary_json TEXT,
  change_ids_json TEXT NOT NULL DEFAULT '{"v":1,"data":[]}',
  revision_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_invocation_run ON tool_invocation (run_id, created_at);
