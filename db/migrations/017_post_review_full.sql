-- Migration 017: Human-in-the-loop review layer full specification (posts.status expansion, post_review table, post_human_feedback view)

BEGIN;

-- 1. Expand posts lifecycle/status and review tracking columns if not already present.
-- The base schema only allows queued/publishing/published/failed/skipped; review routes
-- and n8n workflows use pending_review/approved/rejected/auto_published before publish.
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE posts ADD CONSTRAINT posts_status_check
  CHECK (status IN ('queued','publishing','published','failed','skipped',
                    'pending_review','approved','rejected','auto_published'));
ALTER TABLE posts ADD COLUMN IF NOT EXISTS review_timeout_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS review_locked_until TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS review_timeout_minutes INT DEFAULT 120;

-- 2. Create append-only post_review table matching exact specification.
--    Migration 016 shipped an incompatible 1-row-per-post `status`-based table plus an
--    auto-insert trigger. The current app code (services/kb/server.js) targets THIS
--    append-only shape and tracks review state via posts.status/posts.review_timeout_at,
--    so 016's trigger and table are legacy. Drop them so 016→017 and fresh installs both
--    converge here. (No real data is lost: on the 016→017 path, 017 previously aborted, so
--    the review layer was never operational; step 6 backfills current posts.)
DROP TRIGGER IF EXISTS trg_init_post_review ON posts;
DROP FUNCTION IF EXISTS init_post_review();
DROP VIEW IF EXISTS post_human_feedback CASCADE;
DROP TABLE IF EXISTS post_review CASCADE;

CREATE TABLE post_review (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  decision VARCHAR(32) NOT NULL, -- pending_review | approved | rejected | edited | auto_published
  reason_code VARCHAR(32),       -- off_tone | factual_error | too_salesy | banned_phrase_adjacent | other
  reason_note TEXT,
  edited_body TEXT,
  reviewed_by VARCHAR(64) DEFAULT 'operator',
  is_probe BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_review_post_id ON post_review(post_id);
CREATE INDEX IF NOT EXISTS idx_post_review_decision ON post_review(decision);

-- 3. Create post_human_feedback view reducing review history to a single numeric signal per post
-- Mapping: approved/edited = +1.0, rejected = -1.0, auto_published = 0.0, pending_review = 0.0
CREATE OR REPLACE VIEW post_human_feedback AS
SELECT 
  post_id,
  CASE decision
    WHEN 'approved' THEN 1.0
    WHEN 'edited' THEN 1.0
    WHEN 'rejected' THEN -1.0
    ELSE 0.0
  END AS human_feedback,
  COALESCE(is_probe, false) AS was_probe
FROM (
  SELECT DISTINCT ON (post_id) post_id, decision, is_probe, created_at
  FROM post_review
  ORDER BY post_id, created_at DESC
) latest;

-- 4. Recreate v_post_performance to include human_feedback and was_probe
DROP VIEW IF EXISTS v_contested_verdicts CASCADE;
DROP VIEW IF EXISTS v_technique_performance CASCADE;
DROP VIEW IF EXISTS v_media_performance CASCADE;
DROP VIEW IF EXISTS v_post_performance CASCADE;

CREATE VIEW v_post_performance AS
SELECT
  p.id, p.uid, p.product_id, pr.name AS product_name,
  p.format, p.angle, p.tone, p.sell_intensity, p.length_band,
  p.media_type, p.is_carousel,
  p.published_at, p.char_count,
  EXTRACT(HOUR FROM p.published_at) AS hour_of_day,
  m.views, m.likes, m.replies, m.reposts, m.quotes,
  COALESCE(c.clicks,0)      AS clicks,
  COALESCE(o.orders,0)      AS orders,
  COALESCE(o.commission,0)  AS commission_idr,
  ROUND(COALESCE(c.clicks,0)::numeric / NULLIF(m.views,0) * 100, 3) AS ctr_pct,
  COALESCE(phf.human_feedback, 0.0) AS human_feedback,
  COALESCE(phf.was_probe, false) AS was_probe
FROM posts p
JOIN products pr ON pr.id = p.product_id
LEFT JOIN post_human_feedback phf ON phf.post_id = p.id
LEFT JOIN LATERAL (
  SELECT * FROM post_metrics pm WHERE pm.post_id = p.id ORDER BY pulled_at DESC LIMIT 1
) m ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS clicks FROM clicks cl WHERE cl.post_uid = p.uid AND NOT cl.is_bot
) c ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS orders, sum(commission_idr) AS commission
  FROM conversions cv WHERE cv.post_uid = p.uid AND cv.status <> 'cancelled'
) o ON true
WHERE p.status = 'published';

-- Recreate dependent views
CREATE VIEW v_technique_performance AS
SELECT t.code, t.name, t.type, t.contested,
       ts.title AS source,
       count(tu.post_id)                        AS uses,
       round(avg(ps.final_score)::numeric, 3)   AS mean_score,
       round(avg(ps.final_score)::numeric
             - (SELECT avg(final_score) FROM post_scores), 3) AS lift_vs_all,
       sum(vp.clicks)                           AS clicks,
       sum(vp.orders)                           AS orders,
       sum(vp.commission_idr)                   AS commission,
       t.cooldown_until
FROM techniques t
LEFT JOIN technique_sources ts ON ts.id = t.source_id
LEFT JOIN technique_usage tu ON tu.technique_id = t.id
LEFT JOIN post_scores ps ON ps.post_id = tu.post_id
LEFT JOIN v_post_performance vp ON vp.id = tu.post_id
GROUP BY t.id, t.code, t.name, t.type, t.contested, ts.title, t.cooldown_until
ORDER BY mean_score DESC NULLS LAST;

CREATE VIEW v_contested_verdicts AS
SELECT v.code, v.name, t.contested_note, v.uses, v.mean_score, v.lift_vs_all,
       CASE WHEN v.uses < 6 THEN 'not enough data'
            WHEN v.lift_vs_all > 0.15 THEN 'CONFIRMED for your audience'
            WHEN v.lift_vs_all < -0.15 THEN 'REJECTED for your audience'
            ELSE 'no measurable effect' END AS verdict
FROM v_technique_performance v
JOIN techniques t ON t.code = v.code
WHERE v.contested ORDER BY v.uses DESC;

CREATE VIEW v_media_performance AS
SELECT media_type,
       count(*)                                        AS posts,
       round(avg(views))                               AS avg_views,
       round(avg(clicks)::numeric, 2)                  AS avg_clicks,
       round(avg(ctr_pct)::numeric, 3)                 AS avg_ctr_pct,
       sum(orders)                                     AS orders,
       sum(commission_idr)                             AS commission,
       round(avg(char_count))                          AS avg_chars
FROM v_post_performance
GROUP BY media_type ORDER BY avg_ctr_pct DESC NULLS LAST;

-- 5. Ensure w_human exists in settings.scoring
UPDATE settings
SET value = jsonb_set(value, '{w_human}', '0.15', true)
WHERE key = 'scoring';

INSERT INTO settings (key, value)
VALUES ('scoring', '{"w_ctr":0.25,"w_eng":0.20,"w_epm":0.55,"w_human":0.15,"min_views":200,"bayesian_prior_clicks":50}')
ON CONFLICT (key) DO NOTHING;

-- 6. Backfill existing queued/published posts into post_review if not present
INSERT INTO post_review (post_id, decision, reviewed_by, created_at)
SELECT id, 
       CASE WHEN status = 'published' THEN 'auto_published' ELSE 'pending_review' END,
       'migration_backfill',
       now()
FROM posts
WHERE id NOT IN (SELECT post_id FROM post_review)
ON CONFLICT DO NOTHING;

COMMIT;
