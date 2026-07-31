-- Migration 013: Add threads_comments table for L4 reply loop
--
-- This table stores comments fetched from the Threads API so the L4 reply loop
-- can track which comments have been replied to and avoid duplicates.

BEGIN;

-- Create threads_comments table
CREATE TABLE IF NOT EXISTS threads_comments (
  id              BIGSERIAL PRIMARY KEY,
  comment_id      TEXT UNIQUE NOT NULL,         -- Threads API comment ID
  post_id         BIGINT REFERENCES posts(id) ON DELETE CASCADE,
  username        TEXT,                         -- commenter's Threads username
  text            TEXT NOT NULL,                -- comment text
  created_at      TIMESTAMPTZ NOT NULL,         -- when the comment was posted on Threads
  fetched_at      TIMESTAMPTZ DEFAULT now(),    -- when we fetched it
  metadata        JSONB DEFAULT '{}',           -- additional metadata from Threads API
  UNIQUE (comment_id, post_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS threads_comments_post_idx ON threads_comments (post_id);
CREATE INDEX IF NOT EXISTS threads_comments_created_idx ON threads_comments (created_at DESC);
CREATE INDEX IF NOT EXISTS threads_comments_username_idx ON threads_comments (username);

-- Add foreign key to l4_replies if it exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'l4_replies_post_id_fkey'
  ) THEN
    ALTER TABLE l4_replies ADD CONSTRAINT l4_replies_post_id_fkey
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Create view for easy querying of comments with reply status
CREATE OR REPLACE VIEW v_comments_with_reply_status AS
SELECT 
  tc.id,
  tc.comment_id,
  tc.post_id,
  tc.username,
  tc.text,
  tc.created_at,
  tc.fetched_at,
  p.uid AS post_uid,
  p.body AS post_body,
  p.purpose AS post_purpose,
  p.published_at AS post_published_at,
  CASE 
    WHEN lr.id IS NOT NULL THEN true
    ELSE false
  END AS has_reply,
  lr.status AS reply_status,
  lr.reply_text,
  lr.published_at AS reply_published_at
FROM threads_comments tc
JOIN posts p ON p.id = tc.post_id
LEFT JOIN l4_replies lr ON lr.comment_id = tc.comment_id
ORDER BY tc.created_at DESC;

-- Add trigger to update fetched_at on update
CREATE OR REPLACE FUNCTION update_fetched_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.fetched_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS threads_comments_update_fetched_at ON threads_comments;
CREATE TRIGGER threads_comments_update_fetched_at
  BEFORE UPDATE ON threads_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_fetched_at();

COMMIT;

-- Log migration
INSERT INTO run_log (workflow, level, message)
VALUES ('migration', 'info', 'Migration 013: Added threads_comments table for L4 reply loop')
ON CONFLICT DO NOTHING;
