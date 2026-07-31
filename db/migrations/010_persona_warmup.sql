-- Migration 010: Persona / account-warmup layer for wf6_persona.
-- Adds:
--   * `posts.purpose`     ('product' | 'persona') — distinguishes affiliate posts from no-link persona posts
--   * `posts.persona_topic_id` — FK to persona_topics (nullable; only set on persona posts)
--   * `posts.topic_context` — JSONB cached Perplexity/topic context (angles, timeliness) at generation time
--   * `persona_topics`    — topic pool with Thompson-sampling stats (same Beta(alpha,beta) scheme as arm_stats)
--   * `persona_topic_sources` — provenance for topics (seed, perplexity_weekly, manual)
--   * account-warmup settings row defaults for `settings.warmup`
--   * persona-post-specific banned phrases (link/promo/CTA words) already covered by the QA gate but
--     we add an opener-block list for persona posts here so they don't feel like broadcasts
--
-- This migration is idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS) and does not break existing
-- product posts: product rows keep purpose='product' (default) and all new columns are nullable.

-- ─────────────────────────────────────────── posts.purpose + persona metadata

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'product'
    CHECK (purpose IN ('product','persona')),
  ADD COLUMN IF NOT EXISTS persona_topic_id BIGINT,
  ADD COLUMN IF NOT EXISTS topic_context JSONB DEFAULT '{}';

-- persona_topic_id is constrained below (after the table exists).

-- ─────────────────────────────────────────── Add missing UNIQUE constraints needed
-- for the seeds' ON CONFLICT DO NOTHING clauses to work (psql requires an explicit
-- unique index / constraint for ON CONFLICT). We add these idempotently.

-- technique_sources.title should be unique (same source title → same bucket).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'technique_sources_title_key'
  ) THEN
    ALTER TABLE technique_sources ADD CONSTRAINT technique_sources_title_key UNIQUE (title);
  END IF;
END $$;

-- banned_phrases pattern+scope should be unique (same regex, same scope → same rule).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'banned_phrases_pattern_scope_key'
  ) THEN
    ALTER TABLE banned_phrases ADD CONSTRAINT banned_phrases_pattern_scope_key UNIQUE (pattern, scope);
  END IF;
END $$;

-- run_log has no natural key — change ON CONFLICT DO NOTHING in seed logs to a
-- plain INSERT (no ON CONFLICT) at the bottom of this file.

-- ─────────────────────────────────────────── persona_topic_sources (provenance)

CREATE TABLE IF NOT EXISTS persona_topic_sources (
  id          BIGSERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  label       TEXT NOT NULL,              -- 'starter_seed' | 'perplexity_weekly' | 'manual' | 'trending'
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO persona_topic_sources (slug, label, description) VALUES
  ('starter_seed',     'starter_seed',     'Hand-curated Malaysian household / petua / everyday-life seed topics for account warm-up'),
  ('perplexity_weekly','perplexity_weekly','Auto-discovered via Perplexity Sonar weekly topic refresh'),
  ('manual',           'manual',           'Manually pinned by the operator (SQL or UI override)'),
  ('trending_manual',  'trending_manual',  'Operator-flagged trending topic to prioritise')
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────────────────────────── persona_topics

CREATE TABLE IF NOT EXISTS persona_topics (
  id              BIGSERIAL PRIMARY KEY,
  uid             TEXT UNIQUE NOT NULL DEFAULT substr(md5(random()::text || clock_timestamp()::text),1,10),
  source_id       BIGINT REFERENCES persona_topic_sources(id) ON DELETE SET NULL,
  topic           TEXT NOT NULL,            -- short hook / question / observation seed (e.g. "petua simpan sayur")
  angle_hint      TEXT,                     -- optional hint for the writer: "soalan", "luahan", "petua", "borang", "rant"
  niche_tags      TEXT[] DEFAULT '{}',      -- household | cooking | work | commute | parenting | pet | etc
  lang            TEXT NOT NULL DEFAULT 'ms-MY',
  pinned          BOOLEAN DEFAULT false,    -- operator-forced priority (e.g. breaking / timely angle)

  -- Bandit stats (same Thompson-sampling scheme used in arm_stats, just over topics)
  n               NUMERIC DEFAULT 0,
  reward_sum      NUMERIC DEFAULT 0,
  alpha           NUMERIC DEFAULT 1,
  beta            NUMERIC DEFAULT 1,
  cooldown_until  TIMESTAMPTZ,

  -- Cached Perplexity/timeliness context (small JSON, regenerated weekly)
  last_context_at TIMESTAMPTZ,
  context         JSONB DEFAULT '{}',       -- { angles: [...], timely_note: "...", refreshed_at: "..." }

  times_picked    INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS persona_topics_enabled_idx ON persona_topics (pinned, times_picked);
CREATE INDEX IF NOT EXISTS persona_topics_cooldown_idx ON persona_topics (cooldown_until) WHERE cooldown_until IS NOT NULL;

-- (source_id, topic) must be unique so the starter seed's ON CONFLICT works and we never
-- duplicate the same topic from the same source. Manual/perplexity can insert same-text
-- topics from DIFFERENT sources (e.g. perplexity refreshes a seed topic).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'persona_topics_source_id_topic_key'
  ) THEN
    ALTER TABLE persona_topics ADD CONSTRAINT persona_topics_source_id_topic_key UNIQUE (source_id, topic);
  END IF;
END $$;

-- Add FK now that the table exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_persona_topic_id_fkey'
  ) THEN
    ALTER TABLE posts ADD CONSTRAINT posts_persona_topic_id_fkey
      FOREIGN KEY (persona_topic_id) REFERENCES persona_topics(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────── starter persona topics (Malaysian household / everyday)
-- These seed the pool from day 1 so wf6 can post before Perplexity wiring is complete.
-- Angles are deliberately varied: relatable complaint, 1-sentence petua, soalan, borang pendapat,
-- small observation. None require a product or image. None carry a CTA.

INSERT INTO persona_topics (source_id, topic, angle_hint, niche_tags)
SELECT s.id, v.topic, v.angle_hint, v.niche_tags::TEXT[]
FROM persona_topic_sources s
CROSS JOIN (VALUES
  -- Household / petua
  ('Petua simpan sayur dalam peti ais tahan seminggu tanpa layu',                                   'petua',      ARRAY['household','dapur','sayur']),
  ('Sinki dapur tersumbat selalunya sebab minyak sejuk beku, bukan sisa makanan',                    'petua',      ARRAY['household','dapur']),
  ('Bila kipas rumah mula bunyi bising, 9 kali dari 10 cuma perlu ketatkan skru penutup sahaja',     'petua',      ARRAY['household','rumah']),
  ('Kain tuala yang tak lembut walaupun dah basuh berkali — cuba kurang sabun, bukan tambah',        'petua',      ARRAY['household','dobi']),
  ('Rice cooker aku lebih sedap nasi lepas aku buang air basuhan pertama dan ganti air paip baru',   'petua',      ARRAY['household','dapur','masak']),
  ('Cara aku simpan cili kering tak berkulat: lap kering, masuk bekas bertutup dalam peti sejuk',    'petua',      ARRAY['household','dapur']),
  -- Everyday frustrations / luahan
  ('Baru perasan orang Malaysia cakap "nanti" tapi maksudnya "tak jadi"',                            'luahan',     ARRAY['orang','culture']),
  ('Yang paling menyampah bila beli barang online: gambar cantik, realiti barang plastic cap ayam',  'rant',       ARRAY['shopping','online']),
  ('Grabfood rider sampai depan rumah tapi tak tekan "arrived", kita tertunggu dekat pintu',         'luahan',     ARRAY['commute','everyday']),
  ('Hari hujan lebat, Waze suruh masuk jalan kampung, kita ikut dan akhirnya sesat 20 minit',        'rant',       ARRAY['commute','hujan','driving']),
  ('Bila buka Group WhatsApp keluarga waktu raya, semua hantar sticker dan forward yang sama',       'luahan',     ARRAY['family','culture']),
  ('Setiap kali cuba "jimat elektrik", akhirnya buka aircond juga sebab Malaysia memang panas',     'luahan',     ARRAY['household','cuaca']),
  -- Work / WFH / office
  ('Meeting jam 8.30 pagi yang sebenarnya boleh dibuat dalam 3 ayat WhatsApp',                       'rant',       ARRAY['work','office']),
  ('WFH rupanya lagi penat dari pergi pejabat sebab kerja tak pernah "tutup"',                       'luahan',     ARRAY['work','wfh']),
  ('Email hantar jam 6pm Jumaat = orang itu tak suka kamu',                                         'luahan',     ARRAY['work','office']),
  ('Kawan ofis yang selalu bawa bekal — dia lah orang paling kaya dalam diam',                       'observation',ARRAY['work','office','money']),
  -- Petua kewangan / small money
  ('Duit paling senang hilang: RM5 cash keluar pergi beli air teh tarik setiap petang',             'observation',ARRAY['money','everyday']),
  ('Beli barang 9.90 tapi bayar pos 7.00 — akhirnya tak beli dan guna barang yang ada',             'petua',      ARRAY['money','shopping']),
  ('Setiap awal bulan aku cuba "jimat", setiap 7 hari bulan poket dah ringan',                        'luahan',     ARRAY['money','bulanan']),
  -- Food / mamak / makan
  ('Mamak yang buat teh tarik kurang manis selalunya teh dia lagi sedap',                            'observation',ARRAY['food','mamak']),
  ('Roti canai kosong + teh o ais kurang manis = sarapan paling underrated RM2.50',                  'observation',ARRAY['food','mamak']),
  ('Bila masak nasi goreng guna nasi semalam, lagi sedap dari nasi baru',                            'petua',      ARRAY['food','masak']),
  ('Kadang-kadang masak simple telur dadar + kicap lagi puas hati dari makan luar',                 'observation',ARRAY['food','masak']),
  -- Soalan (engagement bait that is genuine)
  ('Korang biasa tukar berus gigi setiap 3 bulan ke atau sampai berus kembang baru tukar?',          'soalan',     ARRAY['selfcare','everyday']),
  ('Petua apa yang korang guna untuk hilang rasa pedas dalam mulut lepas makan cili?',               'soalan',     ARRAY['food','tips']),
  ('Rumah korang siap kemas semua sekali hari minggu atau kemas 1 bahagian setiap hari?',           'soalan',     ARRAY['household','routine']),
  ('Korang jenis simpan resit beli barang ke terus buang? Aku sampai sekarang simpan dalam wallet',  'soalan',     ARRAY['money','routine']),
  ('Bila bau hujan petang-petang, korang paling craving makanan apa?',                               'soalan',     ARRAY['food','cuaca','hujan']),
  -- Seasonal / cuaca
  ('Musim hujan ni paling best masak sup panas-panas dan tidur awal',                                 'observation',ARRAY['cuaca','hujan','food']),
  ('Payung yang paling kerap hilang: payung yang paling murah dan paling mahal je yang tinggal',     'observation',ARRAY['cuaca','everyday']),
  ('Jaket hujan motor yang lipat kecil tu — selesa dipakai tapi confirm akan koyak dalam bulan ke-3','observation',ARRAY['commute','hujan','motor'])
) AS v(topic, angle_hint, niche_tags)
ON CONFLICT (source_id, topic) DO NOTHING;

-- ─────────────────────────────────────────── persona-specific opener bans
-- These are phrases that are classic "broadcast" / "influencer" opens that persona posts must
-- never use — they're the fastest way to sound like a brand account. Product posts can still
-- use them (rarely, via the format lever); persona posts get a stricter gate.

INSERT INTO banned_phrases (pattern, reason, scope) VALUES
  ('^\\s*Korang (pernah|rasa|tahu|perasan) tak\\b',                 'broadcast opener (persona)', 'persona_opener'),
  ('^\\s*Siapa (kat sini|di sini|yang)\\b',                         'engagement bait (persona)',  'persona_opener'),
  ('^\\s*(Jom|Jangan lepaskan|Save dulu|Share)\\b',                  'CTA opener (persona)',       'persona_opener'),
  ('^\\s*(Thread|Post) kali ini\\b',                                 'influencer cadence',         'persona_opener'),
  ('^\\s*(Hai semua|Assalammualaikum semua|Hi korang)\\b',           'broadcast greeting',         'persona_opener'),
  ('(link (di|kat) (bawah|bio)|klik link|check out|beli sekarang)',  'promo language in persona',  'persona_all')
ON CONFLICT (pattern, scope) DO NOTHING;

-- ─────────────────────────────────────────── account warm-up default (settings row)
-- wf2/wf6 read this to decide how many persona vs product slots to produce each day.
-- Operators can override by updating the settings row.

INSERT INTO settings (key, value)
VALUES (
  'warmup',
  '{
    "enabled": true,
    "started_at": null,
    "phase": null,
    "phases": [
      { "name": "warmup",   "persona_per_day": 4, "product_per_day": 0, "min_days": 14 },
      { "name": "ramp",     "persona_per_day": 4, "product_per_day": 1, "min_days": 16 },
      { "name": "steady",   "persona_per_day": 3, "product_per_day": 2 }
    ],
    "persona_slot_hours": [7, 11, 16, 21],
    "persona_jitter_min": 22,
    "persona_skip_prob": 0.08,
    "persona_micro_pct": 0.25,
    "persona_mid_pct": 0.6,
    "persona_long_pct": 0.15,
    "persona_max_carousel_per_day": 0,
    "perplexity_refresh_enabled": false,
    "perplexity_model": "sonar",
    "perplexity_max_topics_per_refresh": 8
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────── persona-specific run_log + reply loop settings
-- L4 (reply loop) needs to know whether a post is persona or product to pick the reply prompt.
-- That info already lives on posts.purpose — no new table needed. Add an index for it so
-- wf4 scoring of persona engagement stays fast.

CREATE INDEX IF NOT EXISTS posts_purpose_published_idx ON posts (purpose, published_at DESC)
  WHERE status = 'published';

-- Record that this migration ran (run_log has no unique key; wrap in DO block so re-runs
-- don't double-log but also don't fail).
INSERT INTO run_log (workflow, level, message, meta)
VALUES ('migration', 'info', 'migration 010 applied: persona schema + warmup layer seeded',
        jsonb_build_object('migration', '010_persona_warmup', 'topics_seeded', 30));
