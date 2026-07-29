-- 004_contextual_bandit_and_fingerprint.sql
-- ThreadsFlow 2026 upgrade:
--   1) contextual bandit priors/stats for time-of-day tone selection
--   2) redirector v2 browser fingerprint pingback audit columns

BEGIN;

ALTER TABLE clicks
  ADD COLUMN IF NOT EXISTS bot_reason TEXT,
  ADD COLUMN IF NOT EXISTS fingerprint JSONB,
  ADD COLUMN IF NOT EXISTS fingerprint_score INT,
  ADD COLUMN IF NOT EXISTS pinged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS clicks_post_uid_ip_hash_ts_idx ON clicks (post_uid, ip_hash, ts DESC);

CREATE TABLE IF NOT EXISTS context_weights (
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

CREATE INDEX IF NOT EXISTS context_weights_context_bucket_lever_kind_idx
  ON context_weights (context_bucket, lever_kind);

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
ON CONFLICT (context_bucket, lever_kind, lever_code) DO NOTHING;

COMMIT;
