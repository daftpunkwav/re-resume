-- Removal of the legacy v1 tables that no v2 module reads or writes.
--
-- Why this is a new version instead of an edit of version 6: version 6 was
-- registered and recorded while its file held a comment only, and the plugin's
-- ledger validates the checksum of every applied body. Changing an applied body
-- stops the database from opening, so the removal ships as version 10.
--
-- What is left to remove: version 8 already dropped the v1 run/provenance chain
-- (`tool_invocation`, `variant`, `claim`, `document_revision`, `job_posting`,
-- `agent_run`) while it replaced the same-name tables with their v2 shapes, and
-- version 9 dropped the v1 resume family. That leaves `experience` and
-- `profile`, which no v2 table reuses. `claim` and `variant` are dropped
-- defensively so a database that skipped an earlier removal still converges;
-- on the normal upgrade path they are already gone.
--
-- Why these names may be dropped: none of them is a v2 table. The v2 truth
-- lives in `app_settings`, `provider_config`, `custom_module`, `info_entry`,
-- `change_record`, `conversation`, `message`, `attachment`, `job_posting`,
-- `agent_run`, `tool_invocation`, `resume`, `resume_revision` and
-- `resume_snapshot`; this version must not name any of them in a DROP.
--
-- Why the v1 rows are not converted: v2 has no counterpart for an Experience,
-- Variant or Claim, and a Profile is now a `personal` info entry. Any mapping
-- would have to invent content. The copy the native shell makes before the
-- first migration (`re-resume.pre-v2.db`) keeps the old data readable.
--
-- Drop order follows the foreign keys: `claim` and `variant` reference
-- `experience`, so those children go first. `profile` has no dependents.

DROP TABLE IF EXISTS claim;
DROP TABLE IF EXISTS variant;
DROP TABLE IF EXISTS experience;
DROP TABLE IF EXISTS profile;
