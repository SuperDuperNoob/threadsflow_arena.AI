-- Migration 016 intentionally left as a no-op.
--
-- The original 016 created a `post_review` table with a status/human_feedback
-- schema that conflicts with the canonical review schema in 017_post_review_full.sql.
-- Runtime code in services/kb/server.js uses 017's append-only shape
-- (decision, reason_note, reason_code, edited_body, reviewed_by, is_probe), so 017 is
-- now the sole source of truth for human-in-the-loop review tables, views, and
-- posts.review_* columns.

BEGIN;

INSERT INTO run_log (workflow, level, message)
VALUES ('migration', 'info', 'Migration 016: no-op; canonical post_review schema is applied by 017');

COMMIT;
