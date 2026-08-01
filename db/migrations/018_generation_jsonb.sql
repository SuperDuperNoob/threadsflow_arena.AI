-- Migration 018: Convert posts.generation from INT to JSONB
-- The wf2 "Queue post" node inserts a JSON string into generation,
-- but the schema defines it as INT DEFAULT 0.
-- This migration converts the column to JSONB and casts existing ints.

BEGIN;

-- Convert generation column from INT to JSONB
-- Existing INT values (e.g., 0) become JSONB numbers (e.g., "0")
-- Must drop default first, then alter type, then set new default
ALTER TABLE posts ALTER COLUMN generation DROP DEFAULT;
ALTER TABLE posts ALTER COLUMN generation TYPE JSONB USING generation::text::jsonb;

-- Set default to '{}' (empty object) instead of 0
ALTER TABLE posts ALTER COLUMN generation SET DEFAULT '{}'::jsonb;

-- Log the migration
INSERT INTO run_log (workflow, level, message)
VALUES ('migration', 'info', 'Migration 018: posts.generation converted to JSONB');

COMMIT;