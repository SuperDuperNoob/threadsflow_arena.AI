-- ThreadsFlow schema (PostgreSQL 16)
-- Run: psql -U threadsflow -d threadsflow -f db/schema.sql

-- pgcrypto is used only for the default product uid. It ships with postgres:16-alpine but is
-- absent from some minimal builds, so we degrade to md5(random()) rather than fail the install.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgcrypto unavailable, falling back to md5(random()) for uid defaults';
END $$;

CREATE OR REPLACE FUNCTION tf_short_uid() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT substr(md5(random()::text || clock_timestamp()::text), 1, 8);
$$;

-- ─────────────────────────────────────────── products

CREATE TABLE products (
  id             BIGSERIAL PRIMARY KEY,
  uid            TEXT UNIQUE NOT NULL DEFAULT tf_short_uid(),
  name           TEXT,
  affiliate_url  TEXT NOT NULL,            -- buyer/money link; redirector uses this for commission tracking
  product_url    TEXT,                     -- optional plain Shopee URL for enrichment only, never buyer redirects
  description    TEXT,                     -- product description; the ONLY raw material when
                                           -- no images are supplied, so intake demands more of it
  notes          TEXT,                     -- your free-text hints ("buat ibu-ibu, RM39")
  media_mode     TEXT NOT NULL DEFAULT 'text'
                 CHECK (media_mode IN ('images','text')),
  enrichment     JSONB DEFAULT '{}',       -- {price, rating, sold, reviews:[...], category}
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','resting','archived')),
  rest_until     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE product_images (
  id           BIGSERIAL PRIMARY KEY,
  product_id   BIGINT REFERENCES products(id) ON DELETE CASCADE,
  public_url   TEXT NOT NULL,              -- must be publicly fetchable by Meta
  vision_desc  TEXT,                       -- what's literally in the image
  width        INT, height INT, bytes INT,
  use_count    INT DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────── levers (editable from UI, not hardcoded)

CREATE TABLE levers (
  id       BIGSERIAL PRIMARY KEY,
  kind     TEXT NOT NULL CHECK (kind IN
             ('format','angle','tone','sell_intensity','length_band','media_type')),
  code     TEXT NOT NULL,
  label    TEXT NOT NULL,
  brief    TEXT NOT NULL,        -- the instruction fragment injected into the prompt
  enabled  BOOLEAN DEFAULT true,
  UNIQUE (kind, code)
);

CREATE TABLE banned_phrases (
  id       BIGSERIAL PRIMARY KEY,
  pattern  TEXT NOT NULL,        -- regex, case-insensitive
  reason   TEXT,
  scope    TEXT DEFAULT 'all',   -- 'all' | 'opener' | tone code
  added_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE cta_variants (
  id       BIGSERIAL PRIMARY KEY,
  text     TEXT NOT NULL,        -- may contain {{link}}
  enabled  BOOLEAN DEFAULT true,
  use_count INT DEFAULT 0
);

-- ─────────────────────────────────────────── persona corpus
-- Optional Malaysian-Dataset / local-crawl style snippets. These teach cadence and register,
-- not facts. Keep full datasets out of Git; ingest only small, attributed excerpts into DB.

CREATE TABLE persona_sources (
  id              BIGSERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  dataset_name    TEXT NOT NULL DEFAULT 'malaysian-dataset',
  source_url      TEXT NOT NULL,
  source_domain   TEXT,
  license_note    TEXT,
  usage_allowed   BOOLEAN DEFAULT false, -- must be explicitly enabled after license review
  enabled         BOOLEAN DEFAULT true,
  imported_at     TIMESTAMPTZ DEFAULT now(),
  meta            JSONB DEFAULT '{}'
);

CREATE TABLE persona_snippets (
  id              BIGSERIAL PRIMARY KEY,
  source_id       BIGINT REFERENCES persona_sources(id) ON DELETE CASCADE,
  source_url      TEXT,
  source_domain   TEXT,
  title           TEXT,
  lang            TEXT DEFAULT 'ms-MY',
  register        TEXT DEFAULT 'neutral', -- reflective | conversational | informative | formal | neutral
  tags            TEXT[] DEFAULT '{}',
  text            TEXT NOT NULL,
  text_sha256     TEXT UNIQUE NOT NULL,
  char_count      INT,
  usage_allowed   BOOLEAN DEFAULT false,
  enabled         BOOLEAN DEFAULT true,
  use_count       INT DEFAULT 0,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON persona_snippets (enabled, usage_allowed, register);
CREATE INDEX ON persona_snippets USING gin (tags);
CREATE INDEX ON persona_snippets (source_domain);

CREATE VIEW v_persona_snippets_for_prompt AS
SELECT id, source_domain AS domain, title, register, tags, text
FROM persona_snippets
WHERE enabled AND usage_allowed
  AND char_count BETWEEN 120 AND 700
ORDER BY random()
LIMIT 80;

-- ─────────────────────────────────────────── posts

CREATE TABLE posts (
  id                BIGSERIAL PRIMARY KEY,
  uid               TEXT UNIQUE NOT NULL,   -- short base36, used as Shopee SubId + redirect slug
  product_id        BIGINT REFERENCES products(id),
  image_ids         BIGINT[] DEFAULT '{}',
  media_type        TEXT NOT NULL DEFAULT 'IMAGE'
                    CHECK (media_type IN ('TEXT','IMAGE','CAROUSEL')),
  -- levers
  format            TEXT NOT NULL,
  angle             TEXT NOT NULL,
  tone              TEXT NOT NULL,
  sell_intensity    SMALLINT NOT NULL,
  length_band       TEXT NOT NULL,
  is_carousel       BOOLEAN DEFAULT false,
  -- content
  body              TEXT NOT NULL,
  cta_text          TEXT,
  tracked_url       TEXT,
  embedding         REAL[],                 -- for anti-repetition similarity
  char_count        INT,
  emoji_count       INT,
  hashtag_used      BOOLEAN DEFAULT false,
  -- lifecycle
  status            TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','publishing','published','failed','skipped')),
  scheduled_at      TIMESTAMPTZ NOT NULL,
  published_at      TIMESTAMPTZ,
  threads_media_id  TEXT,
  threads_reply_id  TEXT,
  reply_delay_sec   INT,
  fail_reason       TEXT,
  parent_post_id    BIGINT REFERENCES posts(id),  -- set when this is a "bred" variation of a winner
  generation        INT DEFAULT 0,
  cycle_id          BIGINT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  -- A post claiming images must actually have them. Without this, wf3 calls the Threads API
  -- with media_type=IMAGE and a null image_url and fails opaquely 30 seconds later.
  CONSTRAINT posts_media_consistency_chk CHECK (
       (media_type = 'TEXT'     AND cardinality(COALESCE(image_ids,'{}')) = 0)
    OR (media_type = 'IMAGE'    AND cardinality(COALESCE(image_ids,'{}')) = 1)
    OR (media_type = 'CAROUSEL' AND cardinality(COALESCE(image_ids,'{}')) BETWEEN 2 AND 20))
);
CREATE INDEX ON posts (status, scheduled_at);
CREATE INDEX ON posts (published_at DESC);
CREATE INDEX ON posts (product_id);

-- ─────────────────────────────────────────── measurement

CREATE TABLE post_metrics (          -- one row per post per pull (time series, not overwrite)
  id          BIGSERIAL PRIMARY KEY,
  post_id     BIGINT REFERENCES posts(id) ON DELETE CASCADE,
  pulled_at   TIMESTAMPTZ DEFAULT now(),
  age_hours   NUMERIC,
  views       INT DEFAULT 0,
  likes       INT DEFAULT 0,
  replies     INT DEFAULT 0,
  reposts     INT DEFAULT 0,
  quotes      INT DEFAULT 0,
  shares      INT DEFAULT 0
);
CREATE INDEX ON post_metrics (post_id, pulled_at DESC);

CREATE TABLE clicks (
  id         BIGSERIAL PRIMARY KEY,
  post_uid   TEXT NOT NULL,
  ts         TIMESTAMPTZ DEFAULT now(),
  ua         TEXT,
  referer    TEXT,
  ip_hash    TEXT,
  country    TEXT,
  is_bot     BOOLEAN DEFAULT false,
  bot_reason TEXT,
  fingerprint JSONB,
  fingerprint_score INT,
  pinged_at  TIMESTAMPTZ
);
CREATE INDEX ON clicks (post_uid, ts);
CREATE INDEX ON clicks (ts);
CREATE INDEX ON clicks (post_uid, ip_hash, ts DESC);

CREATE TABLE conversions (           -- from Shopee affiliate report, joined on sub_id = post.uid
  id             BIGSERIAL PRIMARY KEY,
  post_uid       TEXT,
  order_id       TEXT UNIQUE,
  order_ts       TIMESTAMPTZ,
  item_name      TEXT,
  gmv_idr        NUMERIC,
  commission_idr NUMERIC,
  status         TEXT,               -- pending | completed | cancelled
  ingested_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON conversions (post_uid);

-- ─────────────────────────────────────────── learning

CREATE TABLE arm_stats (             -- marginal stats: one row per lever VALUE
  id           BIGSERIAL PRIMARY KEY,
  scope        TEXT NOT NULL,        -- 'global' or 'product:<uid>'
  lever_kind   TEXT NOT NULL,
  lever_code   TEXT NOT NULL,
  n            NUMERIC DEFAULT 0,    -- fractional because of decay
  reward_sum   NUMERIC DEFAULT 0,
  alpha        NUMERIC DEFAULT 1,    -- Beta prior for Thompson sampling
  beta         NUMERIC DEFAULT 1,
  cooldown_until TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (scope, lever_kind, lever_code)
);

CREATE TABLE context_weights (       -- contextual bandit stats: time bucket × lever value
  id              BIGSERIAL PRIMARY KEY,
  context_bucket  TEXT NOT NULL CHECK (context_bucket IN
                  ('Work_Focus','Lunch_Scroll','Evening_Relax','Late_Night_Impulse')),
  hour_start      SMALLINT NOT NULL CHECK (hour_start BETWEEN 0 AND 23),
  hour_end        SMALLINT NOT NULL CHECK (hour_end BETWEEN 1 AND 24),
  lever_kind      TEXT NOT NULL DEFAULT 'tone' CHECK (lever_kind IN
                  ('format','angle','tone','sell_intensity','length_band','media_type')),
  lever_code      TEXT NOT NULL,
  n               NUMERIC DEFAULT 0,
  reward_sum      NUMERIC DEFAULT 0,
  alpha           NUMERIC DEFAULT 1,
  beta            NUMERIC DEFAULT 1,
  cooldown_until  TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (context_bucket, lever_kind, lever_code)
);
CREATE INDEX ON context_weights (context_bucket, lever_kind);

-- Cold-start priors for the 2026 contextual layer. These are intentionally weak; live data
-- overwrites them through decay + Thompson updates.
INSERT INTO context_weights (context_bucket, hour_start, hour_end, lever_kind, lever_code, alpha, beta) VALUES
('Work_Focus', 6, 12, 'tone', 'minimal', 2.6, 1.4),
('Work_Focus', 6, 12, 'tone', 'deadpan', 2.4, 1.5),
('Work_Focus', 6, 12, 'tone', 'gaul', 1.2, 1.8),
('Work_Focus', 6, 12, 'tone', 'chaotic', 1.0, 2.0),
('Lunch_Scroll', 12, 15, 'tone', 'gaul', 2.0, 1.5),
('Lunch_Scroll', 12, 15, 'tone', 'minimal', 1.8, 1.6),
('Evening_Relax', 15, 22, 'tone', 'chaotic', 2.7, 1.3),
('Evening_Relax', 15, 22, 'tone', 'gaul', 2.5, 1.4),
('Evening_Relax', 15, 22, 'tone', 'enthusiast', 1.8, 1.6),
('Late_Night_Impulse', 22, 6, 'tone', 'chaotic', 2.2, 1.5),
('Late_Night_Impulse', 22, 6, 'tone', 'gaul', 2.0, 1.5),
('Late_Night_Impulse', 22, 6, 'tone', 'deadpan', 1.7, 1.7)
ON CONFLICT DO NOTHING;

CREATE TABLE combo_stats (           -- full combination, only trusted when n >= 4
  id          BIGSERIAL PRIMARY KEY,
  combo_key   TEXT UNIQUE NOT NULL,  -- format|angle|tone|intensity|length
  n           NUMERIC DEFAULT 0,
  reward_sum  NUMERIC DEFAULT 0,
  best_post_id BIGINT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE cycles (
  id           BIGSERIAL PRIMARY KEY,
  started_at   TIMESTAMPTZ,
  ended_at     TIMESTAMPTZ,
  posts_count  INT,
  total_views  INT,
  total_clicks INT,
  total_orders INT,
  total_commission_idr NUMERIC,
  w_money      NUMERIC,              -- shrinkage weight actually used
  digest       JSONB,                -- human-readable: winners, losers, decisions
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE post_scores (
  post_id      BIGINT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  cycle_id     BIGINT REFERENCES cycles(id),
  ctr          NUMERIC, eng NUMERIC, cvr NUMERIC, epm NUMERIC,
  z_ctr NUMERIC, z_eng NUMERIC, z_epm NUMERIC,
  money_score  NUMERIC, eng_score NUMERIC,
  final_score  NUMERIC,
  verdict      TEXT                  -- 'winner' | 'neutral' | 'loser'
);

-- ─────────────────────────────────────────── ops

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE run_log (
  id        BIGSERIAL PRIMARY KEY,
  workflow  TEXT, level TEXT, message TEXT, meta JSONB,
  ts        TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────── convenience views

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
