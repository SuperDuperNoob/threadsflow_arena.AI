-- Migration 020: VIDEO and MIXED_CAROUSEL media type support
-- (a) Replaces posts_media_type_chk to allow 'VIDEO' and 'MIXED_CAROUSEL'
-- (b) Adds media_kind column on product_images (IMAGE/VIDEO)
-- (c) Updates posts_media_consistency_chk for VIDEO/MIXED_CAROUSEL rules
-- (d) Inserts new levers rows for media_type = 'VIDEO' and 'MIXED_CAROUSEL'

BEGIN;

-- 1. Update posts media_type check constraint
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_media_type_chk;
ALTER TABLE posts ADD CONSTRAINT posts_media_type_chk
  CHECK (media_type IN ('TEXT','IMAGE','CAROUSEL','VIDEO','MIXED_CAROUSEL'));

-- 2. Update posts_media_consistency_chk for new media types
-- VIDEO requires exactly 1 asset
-- MIXED_CAROUSEL requires 2-20 assets (mix of images and videos)
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_media_consistency_chk;
ALTER TABLE posts ADD CONSTRAINT posts_media_consistency_chk CHECK (
     (media_type = 'TEXT'          AND cardinality(COALESCE(image_ids,'{}')) = 0)
  OR (media_type = 'IMAGE'         AND cardinality(COALESCE(image_ids,'{}')) = 1)
  OR (media_type = 'CAROUSEL'      AND cardinality(COALESCE(image_ids,'{}')) BETWEEN 2 AND 20)
  OR (media_type = 'VIDEO'         AND cardinality(COALESCE(image_ids,'{}')) = 1)
  OR (media_type = 'MIXED_CAROUSEL' AND cardinality(COALESCE(image_ids,'{}')) BETWEEN 2 AND 20)
);

-- 3. Add media_kind column to product_images (IMAGE or VIDEO)
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS media_kind TEXT NOT NULL DEFAULT 'IMAGE'
  CHECK (media_kind IN ('IMAGE','VIDEO'));

-- 4. Create index for media_kind
CREATE INDEX IF NOT EXISTS idx_product_images_media_kind ON product_images(media_kind);

-- 5. Insert new levers for VIDEO and MIXED_CAROUSEL media_type (Malay only, matching seed_levers_my.sql pattern)
INSERT INTO levers (kind, code, label, brief) VALUES
  ('media_type','VIDEO','Video','Video pendek (≤ 90s). Hook dalam 3 saat pertama, caption ringkas. Tak perlu cerita panjang.'),
  ('media_type','MIXED_CAROUSEL','Campuran Gambar + Video','Carousel bercampur gambar dan video. Urutan visual mesti sokong narasi. Caption rujuk item berbeza.')
ON CONFLICT (kind, code) DO NOTHING;

-- 6. Backfill existing product_images with default media_kind = 'IMAGE'
UPDATE product_images SET media_kind = 'IMAGE' WHERE media_kind IS NULL;

-- Log the migration
INSERT INTO run_log (workflow, level, message)
VALUES ('migration', 'info', 'Migration 020: VIDEO and MIXED_CAROUSEL support added');

COMMIT;