-- Migration 001 — make images optional.
--
-- Three valid intake shapes from here on:
--   A) link + images                (media_mode='images')
--   B) link + images + description  (media_mode='images')
--   C) link + description           (media_mode='text')
--
-- Text-only is NOT a degraded mode. Threads is a text-first feed and text posts frequently
-- out-reach image posts there. It becomes a real arm the bandit tests, tracked via
-- posts.media_type, so within ~6 cycles you will know which actually earns on YOUR account.
--
-- Safe to run on an existing install. Idempotent.

BEGIN;

-- ── products: remember what the user actually supplied
ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS media_mode TEXT NOT NULL DEFAULT 'text';

DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_media_mode_chk
    CHECK (media_mode IN ('images','text'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN products.description IS
  'Free-text product description. Required when no images are supplied; it is then the only '
  'raw material the writer has, so intake enforces a higher minimum length.';
COMMENT ON COLUMN products.media_mode IS
  'images = at least one usable image exists. text = no images, post as TEXT.';

-- backfill existing rows from reality rather than assuming
UPDATE products p SET media_mode = CASE
  WHEN EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id) THEN 'images'
  ELSE 'text' END;

-- ── posts: media_type is now explicit instead of inferred from is_carousel
ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'IMAGE';

DO $$ BEGIN
  ALTER TABLE posts ADD CONSTRAINT posts_media_type_chk
    CHECK (media_type IN ('TEXT','IMAGE','CAROUSEL'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- image_ids must tolerate empty for text posts
ALTER TABLE posts ALTER COLUMN image_ids SET DEFAULT '{}';

UPDATE posts SET media_type = CASE
  WHEN image_ids IS NULL OR cardinality(image_ids) = 0 THEN 'TEXT'
  WHEN is_carousel AND cardinality(image_ids) > 1      THEN 'CAROUSEL'
  ELSE 'IMAGE' END;

-- Guard: a post claiming images must actually have them. This is the invariant that stops
-- wf3 from calling the Threads API with media_type=IMAGE and a null image_url, which fails
-- with an opaque error 30 seconds later.
DO $$ BEGIN
  ALTER TABLE posts ADD CONSTRAINT posts_media_consistency_chk
    CHECK ((media_type = 'TEXT'     AND cardinality(COALESCE(image_ids,'{}')) = 0)
        OR (media_type = 'IMAGE'    AND cardinality(COALESCE(image_ids,'{}')) = 1)
        OR (media_type = 'CAROUSEL' AND cardinality(COALESCE(image_ids,'{}')) BETWEEN 2 AND 20));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── media_type becomes a scored dimension
ALTER TABLE arm_stats DROP CONSTRAINT IF EXISTS arm_stats_lever_kind_check;

INSERT INTO levers (kind, code, label, brief, enabled) VALUES
('media_type','TEXT','Teks saja',
 'Tanpa gambar. Kalimat pertama harus berdiri sendiri karena tidak ada visual yang menahan scroll.',
 true),
('media_type','IMAGE','Satu gambar',
 'Satu gambar. Teks tidak boleh mendeskripsikan ulang isi gambar.', true),
('media_type','CAROUSEL','Carousel',
 'Beberapa gambar. Teks mengacu ke urutan, bukan ke satu gambar saja.', true)
ON CONFLICT (kind, code) DO NOTHING;

-- ── techniques can declare media compatibility
ALTER TABLE techniques ADD COLUMN IF NOT EXISTS compatible_media TEXT[] DEFAULT '{}';
COMMENT ON COLUMN techniques.compatible_media IS
  'Empty = works with or without an image. Otherwise subset of TEXT/IMAGE/CAROUSEL. '
  'Techniques that lean on the photo must not fire on a text-only post.';

-- techniques that reference a visible object only make sense with an image
UPDATE techniques SET compatible_media = '{IMAGE,CAROUSEL}'
 WHERE code IN ('object_first_open');

-- ── view: expose media_type so you can compare text vs image performance
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
  SELECT count(*) AS orders, sum(commission_idr) AS commission
  FROM conversions cv WHERE cv.post_uid = p.uid AND cv.status <> 'cancelled'
) o ON true
WHERE p.status = 'published';

-- recreate the dependents dropped by CASCADE
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

-- ── the comparison you will actually want to read
CREATE OR REPLACE VIEW v_media_performance AS
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

COMMIT;
