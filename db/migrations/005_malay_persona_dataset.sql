-- 005_malay_persona_dataset.sql
-- Malaysian-Dataset / Malaysian web-crawl persona corpus (licensed, auto-enabled).

BEGIN;

CREATE TABLE IF NOT EXISTS persona_sources (
  id              BIGSERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  dataset_name    TEXT NOT NULL DEFAULT 'malaysian-dataset',
  source_url      TEXT NOT NULL,
  source_domain   TEXT,
  license_note    TEXT,
  usage_allowed   BOOLEAN DEFAULT true,
  enabled         BOOLEAN DEFAULT true,
  imported_at     TIMESTAMPTZ DEFAULT now(),
  meta            JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS persona_snippets (
  id              BIGSERIAL PRIMARY KEY,
  source_id       BIGINT REFERENCES persona_sources(id) ON DELETE CASCADE,
  source_url      TEXT,
  source_domain   TEXT,
  title           TEXT,
  lang            TEXT DEFAULT 'ms-MY',
  register        TEXT DEFAULT 'neutral',
  tags            TEXT[] DEFAULT '{}',
  text            TEXT NOT NULL,
  text_sha256     TEXT UNIQUE NOT NULL,
  char_count      INT,
  usage_allowed   BOOLEAN DEFAULT true,
  enabled         BOOLEAN DEFAULT true,
  use_count       INT DEFAULT 0,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Auto-enable all sources and snippets for prompt usage
UPDATE persona_sources SET usage_allowed = true WHERE usage_allowed = false;
UPDATE persona_snippets SET usage_allowed = true WHERE usage_allowed = false;

CREATE INDEX IF NOT EXISTS persona_snippets_enabled_usage_register_idx
  ON persona_snippets (enabled, usage_allowed, register);
CREATE INDEX IF NOT EXISTS persona_snippets_tags_idx
  ON persona_snippets USING gin (tags);
CREATE INDEX IF NOT EXISTS persona_snippets_source_domain_idx
  ON persona_snippets (source_domain);

CREATE OR REPLACE VIEW v_persona_snippets_for_prompt AS
SELECT id, source_domain AS domain, title, register, tags, text
FROM persona_snippets
WHERE enabled AND usage_allowed
  AND char_count BETWEEN 120 AND 700
ORDER BY random()
LIMIT 80;

COMMIT;
