-- Migration 015: Add text variation settings for post paraphrasing
--
-- This feature applies subtle LLM-based variations to posts before publishing to ensure
-- no two posts are exactly identical. This helps avoid duplicate detection and makes
-- the content feel more natural and human.

BEGIN;

-- Add variation settings to the main settings table
INSERT INTO settings (key, value) VALUES (
  'text_variation',
  '{
    "enabled": true,
    "max_changes": 3,
    "preserve_hashtags": true,
    "preserve_mentions": true,
    "preserve_links": true,
    "preserve_emoji": true,
    "min_length_for_variation": 50,
    "temperature": 0.3,
    "model": "gpt-3.5-turbo",
    "workflows": ["wf6_persona", "wf3_publish"]
  }'::jsonb
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Add a tracking table to log variations (for debugging and analysis)
CREATE TABLE IF NOT EXISTS text_variations (
  id SERIAL PRIMARY KEY,
  workflow TEXT NOT NULL,
  post_id TEXT,
  original_text TEXT NOT NULL,
  varied_text TEXT NOT NULL,
  changes_made INTEGER DEFAULT 0,
  validation_passed BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying variations by post
CREATE INDEX IF NOT EXISTS idx_text_variations_post_id ON text_variations(post_id);
CREATE INDEX IF NOT EXISTS idx_text_variations_created_at ON text_variations(created_at DESC);

-- Add comments
COMMENT ON TABLE text_variations IS 'Logs all text variations applied to posts before publishing';
COMMENT ON COLUMN text_variations.changes_made IS 'Number of word/phrase substitutions made';
COMMENT ON COLUMN text_variations.validation_passed IS 'Whether the variation passed validation checks';

COMMIT;
