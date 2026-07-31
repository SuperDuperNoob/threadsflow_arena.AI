-- Migration 019: Make the human-in-the-loop review layer operational.
--
-- Migrations 016/017 created the post_review table and routes that drive posts through the
-- lifecycle  pending_review -> (approved | rejected | edited) -> published, plus an
-- auto_published terminal state when the review window lapses. They also introduced a
-- "posts.status expansion" comment, but never actually relaxed the posts_status_check
-- constraint. As a result any post set to pending_review / approved / rejected /
-- auto_published was (and is) rejected by the CHECK, so the entire review feature was
-- dead on arrival. This migration expands the allowed status set so the feature works.
--
-- The review routes (services/kb/server.js: /api/posts/queue, /api/posts/:id/decision, etc.)
-- and wf2 generation expect exactly these extra states. No existing status is removed.

BEGIN;

-- Drop and recreate the status CHECK with the review lifecycle states added.
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_status_check;

ALTER TABLE posts ADD CONSTRAINT posts_status_check
  CHECK (status = ANY (ARRAY[
    'queued'::text,
    'publishing'::text,
    'published'::text,
    'failed'::text,
    'skipped'::text,
    'draft'::text,
    'pending_review'::text,
    'approved'::text,
    'rejected'::text,
    'auto_published'::text
  ]));

-- Backfill any legacy rows that the migration in 017 expected to exist but could not
-- create because the status was invalid. (Harmless no-op on a fresh install.)
INSERT INTO post_review (post_id, decision, reviewed_by, created_at)
SELECT id,
       CASE WHEN status = 'published' THEN 'auto_published' ELSE 'pending_review' END,
       'migration_019',
       now()
FROM posts
WHERE status IN ('pending_review', 'approved', 'rejected', 'auto_published', 'draft')
  AND id NOT IN (SELECT post_id FROM post_review)
ON CONFLICT DO NOTHING;

COMMIT;