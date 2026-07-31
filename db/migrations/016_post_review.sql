-- Migration 016: Human-in-the-loop review layer, post_review table, views, and scoring weights

BEGIN;

CREATE TABLE IF NOT EXISTS post_review (
  id SERIAL PRIMARY KEY,
  post_id INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE UNIQUE,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_review', -- pending_review | approved | rejected | auto_published
  reviewed_by VARCHAR(64),
  reviewed_at TIMESTAMPTZ,
  reason_code VARCHAR(32), -- off_tone | factual_error | too_salesy | banned_phrase_adjacent | other
  edited_body TEXT,
  review_timeout_at TIMESTAMPTZ NOT NULL,
  review_locked_until TIMESTAMPTZ,
  is_exploration BOOLEAN DEFAULT false,
  human_feedback NUMERIC DEFAULT 0, -- +1 approved/edited, -1 rejected, 0 default/timeout
  was_probe BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_review_status ON post_review(status);
CREATE INDEX IF NOT EXISTS idx_post_review_timeout ON post_review(review_timeout_at) WHERE status = 'pending_review';

CREATE TABLE IF NOT EXISTS post_review_audit (
  id SERIAL PRIMARY KEY,
  post_id INT NOT NULL,
  decision_type VARCHAR(32) NOT NULL, -- human_approval | human_rejection | human_edit | timeout_auto_publish | qa_auto_reject
  reason_code VARCHAR(32),
  meta JSONB,
  ts TIMESTAMPTZ DEFAULT now()
);

-- View providing post_id, human_feedback, was_probe for scoring join
CREATE OR REPLACE VIEW post_human_feedback AS
SELECT post_id, human_feedback, was_probe
FROM post_review;

-- Automatic trigger to initialize post_review when a post is inserted from wf2
CREATE OR REPLACE FUNCTION init_post_review()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO post_review (post_id, review_timeout_at, is_exploration, was_probe)
  VALUES (
    NEW.id,
    COALESCE(NEW.scheduled_at - INTERVAL '120 minutes', now() + INTERVAL '120 minutes'),
    COALESCE((NEW.topic_context->>'is_exploration')::boolean, false),
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

-- Recreate v_post_performance to include human_feedback and was_probe
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
  COALESCE(phf.human_feedback, 0) AS human_feedback,
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
  SELECT count(*) AS orders, sum(commission_minor) AS commission
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

-- Update settings.scoring to include w_human
UPDATE settings
SET value = jsonb_set(value, '{w_human}', '0.15', true)
WHERE key = 'scoring';

INSERT INTO settings (key, value)
VALUES ('scoring', '{"w_ctr":0.25,"w_eng":0.20,"w_epm":0.55,"w_human":0.15,"min_views":200,"bayesian_prior_clicks":50}')
ON CONFLICT (key) DO NOTHING;

COMMIT;
