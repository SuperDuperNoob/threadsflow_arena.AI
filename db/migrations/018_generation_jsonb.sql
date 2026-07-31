-- Migration 018: Convert posts.generation from INT to JSONB.
--
-- wf2_generate.json's "Queue post" code node inserts a JSON object into posts.generation
-- (context_bucket / combo_key / device_ids / plan), but the original schema defined
-- generation as INT DEFAULT 0. That INSERT would fail with a type error, so wf2 could
-- never persist a generated post. wf6_persona inserts 0 which is valid JSONB, so the
-- column stays backward-compatible after this change.
--
-- Idempotent / safe to re-run: only alters the type; existing 0/integer values cast cleanly.

BEGIN;

-- Drop the existing integer default before changing the type (Postgres cannot auto-cast
-- a DEFAULT 0 to jsonb). Re-add a jsonb default afterwards.
ALTER TABLE posts ALTER COLUMN generation DROP DEFAULT;

-- Cast any existing integer values to a JSONB number (0 stays 0).
ALTER TABLE posts
  ALTER COLUMN generation TYPE JSONB
  USING CASE
    WHEN generation IS NULL THEN '{}'::jsonb
    ELSE to_jsonb(generation)
  END;

-- Keep a sane default so inserts that omit the column still work.
ALTER TABLE posts ALTER COLUMN generation SET DEFAULT '{}'::jsonb;

COMMIT;
