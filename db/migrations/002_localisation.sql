-- Migration 002 — currency-neutral money columns + locale settings.
--
-- The schema hard-coded IDR (commission_idr, gmv_idr, price_idr). The customer base is
-- Malaysian, so money is MYR. Rather than swap one hard-coded currency for another, the
-- columns become currency-neutral and the actual currency lives in settings.locale.
--
-- Old names are kept as generated columns so nothing that still reads *_idr breaks.
-- Safe to run on an existing install. Idempotent.

BEGIN;

-- ── conversions
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS gmv_minor        NUMERIC;
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS commission_minor NUMERIC;
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS currency         TEXT NOT NULL DEFAULT 'MYR';

UPDATE conversions SET gmv_minor        = COALESCE(gmv_minor, gmv_idr),
                       commission_minor = COALESCE(commission_minor, commission_idr)
 WHERE gmv_minor IS NULL OR commission_minor IS NULL;

COMMENT ON COLUMN conversions.commission_minor IS
  'Commission in the account currency (settings.locale.currency). Named _minor rather than '
  '_idr/_myr so a second market does not require another migration.';

-- Keep the historical names working. v_post_performance and friends read commission_idr, so
-- the old columns are rebuilt as GENERATED mirrors of the new ones — zero call sites change
-- today, and a future market only needs settings.locale updated.
--
-- The dependent views must be dropped first (Postgres will not drop a referenced column) and
-- are recreated verbatim at the end of this migration.
DROP VIEW IF EXISTS v_contested_verdicts;
DROP VIEW IF EXISTS v_technique_performance;
DROP VIEW IF EXISTS v_media_performance;
DROP VIEW IF EXISTS v_post_performance;

ALTER TABLE conversions DROP COLUMN IF EXISTS gmv_idr;
ALTER TABLE conversions DROP COLUMN IF EXISTS commission_idr;
ALTER TABLE conversions
  ADD COLUMN gmv_idr        NUMERIC GENERATED ALWAYS AS (gmv_minor) STORED,
  ADD COLUMN commission_idr NUMERIC GENERATED ALWAYS AS (commission_minor) STORED;

-- ── cycles
ALTER TABLE cycles ADD COLUMN IF NOT EXISTS total_commission_minor NUMERIC;
UPDATE cycles SET total_commission_minor = COALESCE(total_commission_minor, total_commission_idr)
 WHERE total_commission_minor IS NULL;

-- ── locale row (created here so an upgrade gets it too; seed files also insert it)
INSERT INTO settings (key, value) VALUES
('locale', '{"language":"ms-MY","country":"MY","currency":"MYR",
             "currency_symbol":"RM","timezone":"Asia/Kuala_Lumpur",
             "shopee_domain":"shopee.com.my"}')
ON CONFLICT (key) DO NOTHING;

-- ── posting slots follow Malaysian habits, not Jakarta's
UPDATE settings
   SET value = jsonb_set(
                 jsonb_set(value, '{timezone}', '"Asia/Kuala_Lumpur"'),
                 '{slot_hours}', '[7, 12, 15, 20, 22]')
 WHERE key = 'posting'
   AND COALESCE(value->>'timezone','') <> 'Asia/Kuala_Lumpur';

-- ── Malay banned phrases, additive so an existing install gains them without a reseed
INSERT INTO banned_phrases (pattern, reason, scope) VALUES
('\y(banget|nggak|gak|aja|udah|bikin|gimana|kalian|doang|cowok|cewek)\y',
 'perkataan Indonesia - salah negara', 'all'),
('\ybisa\y',  'bisa = racun dalam BM; guna boleh', 'all'),
('\ybutuh\y', 'butuh = lucah dalam BM; guna perlu', 'all'),
('\ypusing\y','pusing = berputar dalam BM, bukan sakit kepala', 'all'),
('(\yrupiah\y|\yRp\.? ?[0-9])', 'mata wang salah - guna RM', 'all'),
('\y(cepat sebelum|jangan lepaskan peluang|stok terhad|sementara stok ada)\y',
 'urgency palsu', 'all'),
('\y(korang tim mana|komen kat bawah|tulis dalam komen)\y', 'umpan engagement', 'all')
ON CONFLICT DO NOTHING;

-- ── recreate the views dropped above, unchanged apart from reading the mirrored columns
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
  ROUND(COALESCE(c.clicks,0)::numeric / NULLIF(m.views,0) * 100, 3) AS ctr_pct
FROM posts p
JOIN products pr ON pr.id = p.product_id
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

-- ── money view, currency-aware
CREATE OR REPLACE VIEW v_money AS
SELECT (SELECT value->>'currency_symbol' FROM settings WHERE key='locale') AS symbol,
       date_trunc('day', c.order_ts)::date AS day,
       count(*)                            AS orders,
       sum(c.gmv_minor)                    AS gmv,
       sum(c.commission_minor)             AS commission
FROM conversions c
WHERE c.status <> 'cancelled'
GROUP BY 2 ORDER BY 2 DESC;

COMMIT;
