-- 016_post_review.sql: Human-in-the-loop review layer tables, trigger, and audit log.

CREATE TABLE IF NOT EXISTS post_review (
  id SERIAL PRIMARY KEY,
  post_id INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE UNIQUE,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_review', -- pending_review | approved | rejected | auto_published | under_review
  reviewed_by VARCHAR(64) DEFAULT 'operator',
  reviewed_at TIMESTAMPTZ,
  reason_code VARCHAR(32), -- off_tone | factual_error | too_salesy | banned_phrase_adjacent | other
  edited_body TEXT,
  is_exploration BOOLEAN DEFAULT false,
  timeout_at TIMESTAMPTZ NOT NULL,
  under_review_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_review_status ON post_review(status);
CREATE INDEX IF NOT EXISTS idx_post_review_timeout ON post_review(timeout_at) WHERE status = 'pending_review';

CREATE TABLE IF NOT EXISTS post_review_audit (
  id SERIAL PRIMARY KEY,
  post_id INT NOT NULL,
  decision_type VARCHAR(32) NOT NULL, -- human_approval | human_rejection | human_edit | timeout_auto_publish | qa_auto_reject
  reason_code VARCHAR(32),
  meta JSONB,
  ts TIMESTAMPTZ DEFAULT now()
);

-- Automatic trigger to initialize post_review when a post is inserted
CREATE OR REPLACE FUNCTION init_post_review()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO post_review (post_id, timeout_at, is_exploration)
  VALUES (
    NEW.id,
    COALESCE(NEW.scheduled_at - INTERVAL '2 hours', now() + INTERVAL '2 hours'),
    COALESCE((NEW.topic_context->>'is_exploration')::boolean, false)
  )
  ON CONFLICT (post_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_init_post_review ON posts;
CREATE TRIGGER trg_init_post_review
  AFTER INSERT ON posts
  FOR EACH ROW
  EXECUTE FUNCTION init_post_review();

-- Backfill existing posts
INSERT INTO post_review (post_id, status, timeout_at)
SELECT id, 
       CASE WHEN status = 'published' THEN 'auto_published' ELSE 'pending_review' END,
       COALESCE(scheduled_at - INTERVAL '2 hours', now())
FROM posts
ON CONFLICT (post_id) DO NOTHING;
