-- Phase 2: Add VIDEO and MIXED_CAROUSEL media types
-- Idempotent migration for PostgreSQL 16

-- 1. Replace posts_media_type_chk constraint on posts
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_media_type_chk;
ALTER TABLE posts ADD CONSTRAINT posts_media_type_chk
CHECK (media_type IN ('TEXT','IMAGE','CAROUSEL','VIDEO','MIXED_CAROUSEL'));

-- 2. Add media_kind column to product_images
ALTER TABLE product_images
ADD COLUMN IF NOT EXISTS media_kind TEXT NOT NULL DEFAULT 'IMAGE'
CHECK (media_kind IN ('IMAGE','VIDEO'));

-- 3. Insert new levers for media_type (idempotent)
INSERT INTO levers (kind, code, label, brief, enabled) VALUES
('media_type', 'VIDEO', 'Satu video', 'Satu video menyertai post. Teks mendukung isi video.', true),
('media_type', 'MIXED_CAROUSEL', 'Carousel campuran', 'Kombinasi gambar dan video dalam carousel.', true)
ON CONFLICT (kind, code) DO NOTHING;

-- 4. Update posts_media_consistency_chk for VIDEO and MIXED_CAROUSEL
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_media_consistency_chk;
ALTER TABLE posts ADD CONSTRAINT posts_media_consistency_chk CHECK (
     (media_type = 'TEXT'           AND cardinality(COALESCE(image_ids,'{}')) = 0)
  OR (media_type = 'IMAGE'          AND cardinality(COALESCE(image_ids,'{}')) = 1)
  OR (media_type = 'CAROUSEL'       AND cardinality(COALESCE(image_ids,'{}')) BETWEEN 2 AND 20)
  OR (media_type = 'VIDEO'          AND cardinality(COALESCE(image_ids,'{}')) = 1)
  OR (media_type = 'MIXED_CAROUSEL' AND cardinality(COALESCE(image_ids,'{}')) BETWEEN 2 AND 20)
);