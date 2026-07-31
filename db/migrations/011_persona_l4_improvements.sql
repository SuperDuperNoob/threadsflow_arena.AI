-- Migration 011: wf6_persona + L4 reply loop improvements.
--
-- Adds:
--   * `persona_topics.time_of_day` — preferred time-of-day slots for topic affinity
--   * `posts.psychology_techniques` TEXT[] — which psychology techniques were applied to a post
--   * `l4_replies` table — track L4 reply actions (audit, cooldown, rate limiting)
--   * `persona_topic_feedback` — wf4→wf6 feedback for topic bandit updates
--   * L4 reply settings in `settings` table
--   * Time-of-day tags on existing starter topics
--
-- Idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- ─────────────────────────────────────────── persona_topics.time_of_day
ALTER TABLE persona_topics
  ADD COLUMN IF NOT EXISTS time_of_day TEXT[] DEFAULT '{}';

-- ─────────────────────────────────────────── posts.psychology_techniques
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS psychology_techniques TEXT[] DEFAULT '{}';

-- ─────────────────────────────────────────── L4 replies tracking table
CREATE TABLE IF NOT EXISTS l4_replies (
  id              BIGSERIAL PRIMARY KEY,
  uid             TEXT UNIQUE NOT NULL DEFAULT substr(md5(random()::text || clock_timestamp()::text),1,10),
  post_id         BIGINT REFERENCES posts(id) ON DELETE CASCADE,
  comment_id      TEXT NOT NULL,              -- Threads API comment ID
  comment_text    TEXT,                       -- the user's comment (cached for audit)
  intent          TEXT CHECK (intent IN
                    ('link_inquiry', 'price_inquiry', 'experience_inquiry',
                     'compatibility_inquiry', 'casual_banter', 'complaint',
                     'compliment', 'question', 'other')),
  reply_text      TEXT,                       -- the drafted/published reply
  reply_comment_id TEXT,                      -- Threads API reply comment ID (set after publish)
  psychology_techniques TEXT[] DEFAULT '{}',  -- which techniques were applied
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
                    ('draft', 'pending_approval', 'published', 'rejected', 'failed')),
  qa_reasons     TEXT[] DEFAULT '{}',         -- QA rejection reasons (if rejected)
  persona_calibrated BOOLEAN DEFAULT false,   -- whether persona snippets were injected
  created_at      TIMESTAMPTZ DEFAULT now(),
  published_at    TIMESTAMPTZ,
  UNIQUE (comment_id)                         -- one reply per comment
);

CREATE INDEX IF NOT EXISTS l4_replies_post_idx ON l4_replies (post_id);
CREATE INDEX IF NOT EXISTS l4_replies_status_idx ON l4_replies (status);
CREATE INDEX IF NOT EXISTS l4_replies_published_idx ON l4_replies (published_at DESC)
  WHERE status = 'published';

-- ─────────────────────────────────────────── persona_topic_feedback (wf4 → wf6)
-- When wf4 scores a persona post, it writes a feedback row here. wf6 reads these
-- to update persona_topics.alpha/beta via Thompson sampling, closing the loop.
CREATE TABLE IF NOT EXISTS persona_topic_feedback (
  id              BIGSERIAL PRIMARY KEY,
  persona_topic_id BIGINT REFERENCES persona_topics(id) ON DELETE CASCADE,
  post_id         BIGINT REFERENCES posts(id) ON DELETE SET NULL,
  engagement_score NUMERIC DEFAULT 0,         -- normalised 0-1 from wf4 scoring
  reward          NUMERIC DEFAULT 0,          -- binary or continuous reward signal
  metrics         JSONB DEFAULT '{}',         -- raw metrics: {likes, replies, reposts, quotes, views}
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ptf_topic_idx ON persona_topic_feedback (persona_topic_id);
CREATE INDEX IF NOT EXISTS ptf_created_idx ON persona_topic_feedback (created_at DESC);

-- ─────────────────────────────────────────── Tag existing starter topics with time_of_day
-- Morning (7am slot): commute, breakfast, work-start topics
UPDATE persona_topics SET time_of_day = ARRAY['morning']
WHERE topic IN (
  'Meeting jam 8.30 pagi yang sebenarnya boleh dibuat dalam 3 ayat WhatsApp',
  'Roti canai kosong + teh o ais kurang manis = sarapan paling underrated RM2.50',
  'Grabfood rider sampai depan rumah tapi tak tekan "arrived", kita tertunggu dekat pintu'
);

-- Midday (11am slot): work, lunch, office topics
UPDATE persona_topics SET time_of_day = ARRAY['midday']
WHERE topic IN (
  'WFH rupanya lagi penat dari pergi pejabat sebab kerja tak pernah "tutup"',
  'Email hantar jam 6pm Jumaat = orang itu tak suka kamu',
  'Kawan ofis yang selalu bawa bekal — dia lah orang paling kaya dalam diam',
  'Kadang-kadang masak simple telur dadar + kicap lagi puas hati dari makan luar'
);

-- Afternoon (4pm slot): petua, household, shopping
UPDATE persona_topics SET time_of_day = ARRAY['afternoon']
WHERE topic IN (
  'Petua simpan sayur dalam peti ais tahan seminggu tanpa layu',
  'Sinki dapur tersumbat selalunya sebab minyak sejuk beku, bukan sisa makanan',
  'Bila kipas rumah mula bunyi bising, 9 kali dari 10 cuma perlu ketatkan skru penutup sahaja',
  'Kain tuala yang tak lembut walaupun dah basuh berkali — cuba kurang sabun, bukan tambah',
  'Rice cooker aku lebih sedap nasi lepas aku buang air basuhan pertama dan ganti air paip baru',
  'Cara aku simpan cili kering tak berkulat: lap kering, masuk bekas bertutup dalam peti sejuk',
  'Yang paling menyampah bila beli barang online: gambar cantik, realiti barang plastic cap ayam',
  'Beli barang 9.90 tapi bayar pos 7.00 — akhirnya tak beli dan guna barang yang ada',
  'Setiap awal bulan aku cuba "jimat", setiap 7 hari bulan poket dah ringan',
  'Duit paling senang hilang: RM5 cash keluar pergi beli air teh tarik setiap petang',
  'Rumah korang siap kemas semua sekali hari minggu atau kemas 1 bahagian setiap hari?',
  'Korang biasa tukar berus gigi setiap 3 bulan ke atau sampai berus kembang baru tukar?'
);

-- Evening (9pm slot): food, weather, family, reflection
UPDATE persona_topics SET time_of_day = ARRAY['evening']
WHERE topic IN (
  'Mamak yang buat teh tarik kurang manis selalunya teh dia lagi sedap',
  'Bila masak nasi goreng guna nasi semalam, lagi sedap dari nasi baru',
  'Musim hujan ni paling best masak sup panas-panas dan tidur awal',
  'Bila bau hujan petang-petang, korang paling craving makanan apa?',
  'Hari hujan lebat, Waze suruh masuk jalan kampung, kita ikut dan akhirnya sesat 20 minit',
  'Bila buka Group WhatsApp keluarga waktu raya, semua hantar sticker dan forward yang sama',
  'Setiap kali cuba "jimat elektrik", akhirnya buka aircond juga sebab Malaysia memang panas',
  'Baru perasan orang Malaysia cakap "nanti" tapi maksudnya "tak jadi"',
  'Payung yang paling kerap hilang: payung yang paling murah dan paling mahal je yang tinggal',
  'Jaket hujan motor yang lipat kecil tu — selesa dipakai tapi confirm akan koyak dalam bulan ke-3',
  'Petua apa yang korang guna untuk hilang rasa pedas dalam mulut lepas makan cili?',
  'Korang jenis simpan resit beli barang ke terus buang? Aku sampai sekarang simpan dalam wallet'
);

-- Topics that work at any time (leave time_of_day empty = {})
-- 'Baru perasan orang Malaysia cakap...' works anytime
-- Soalan topics work anytime

-- ─────────────────────────────────────────── L4 reply loop settings
INSERT INTO settings (key, value)
VALUES (
  'l4_reply',
  '{
    "enabled": false,
    "max_replies_per_day": 10,
    "max_replies_per_post": 5,
    "cooldown_hours_per_user": 24,
    "post_age_days": 7,
    "min_comment_length": 3,
    "max_reply_length": 180,
    "human_approval_required": false,
    "persona_calibration_enabled": true,
    "psychology_techniques_enabled": true,
    "intent_classification": {
      "enabled": true,
      "model_override": null
    },
    "schedule_interval_hours": 4,
    "timezone": "Asia/Kuala_Lumpur"
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────── Log it
INSERT INTO run_log (workflow, level, message, meta)
VALUES ('migration', 'info', 'migration 011 applied: wf6 persona + L4 reply loop improvements',
        jsonb_build_object('migration', '011_persona_l4_improvements',
                           'new_tables', ARRAY['l4_replies', 'persona_topic_feedback'],
                           'new_columns', ARRAY['persona_topics.time_of_day', 'posts.psychology_techniques']));
