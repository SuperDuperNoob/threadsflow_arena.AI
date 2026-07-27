-- Technique Library — mined once from your NotebookLM copywriting PDFs, then optimized
-- by the same bandit that optimizes tones and formats.
-- Run after schema.sql.

-- ── where techniques came from (provenance matters: you'll want to know which book lied)
CREATE TABLE technique_sources (
  id           BIGSERIAL PRIMARY KEY,
  title        TEXT NOT NULL,           -- "Boron Letters", "Ogilvy on Advertising"
  author       TEXT,
  notebook_id  TEXT,                    -- NotebookLM notebook id, if you used the MCP/CLI
  mined_at     TIMESTAMPTZ DEFAULT now(),
  notes        TEXT
);

-- ── the library itself
CREATE TABLE techniques (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,   -- snake_case, e.g. 'sensory_open'
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN
                ('hook','structure','psychology','voice','cta','anti_pattern','proof','rhythm')),

  -- THE most important column. One imperative sentence the writer LLM can actually execute.
  -- Bad:  "Use the PAS framework."
  -- Good: "Name a physical sensation the reader felt in the last 7 days before naming any
  --        product category."
  instruction   TEXT NOT NULL,

  when_to_use   TEXT,                   -- short guidance for the selector
  mechanism     TEXT,                   -- why it works (for your reading, not the prompt)
  example_do    TEXT,                   -- concrete positive example, ideally rewritten in ID
  example_dont  TEXT,                   -- the near-miss that fails

  -- gating: which lever values this technique is allowed to combine with.
  -- empty array = compatible with everything.
  compatible_formats    TEXT[] DEFAULT '{}',
  compatible_tones      TEXT[] DEFAULT '{}',
  compatible_intensity  SMALLINT[] DEFAULT '{}',

  -- if the source books disagree about this, flag it — these are your best experiments
  contested     BOOLEAN DEFAULT false,
  contested_note TEXT,

  source_id     BIGINT REFERENCES technique_sources(id),
  enabled       BOOLEAN DEFAULT true,

  -- live performance, updated by wf4 exactly like arm_stats
  n             NUMERIC DEFAULT 0,
  reward_sum    NUMERIC DEFAULT 0,
  alpha         NUMERIC DEFAULT 1,
  beta          NUMERIC DEFAULT 1,
  cooldown_until TIMESTAMPTZ,

  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON techniques (type, enabled);

-- ── attribution: which devices were in which post
CREATE TABLE technique_usage (
  post_id      BIGINT REFERENCES posts(id) ON DELETE CASCADE,
  technique_id BIGINT REFERENCES techniques(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, technique_id)
);
CREATE INDEX ON technique_usage (technique_id);

-- ── the extraction questions, kept in the DB so re-mining is reproducible
CREATE TABLE mining_questions (
  id        BIGSERIAL PRIMARY KEY,
  ord       INT,
  question  TEXT NOT NULL,
  target    TEXT,                       -- which technique type this question should yield
  last_run  TIMESTAMPTZ,
  raw_answer TEXT                       -- paste NotebookLM's answer here
);

-- ── performance view: does the book's advice actually make you money?
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

-- ── which contested claims has your data settled?
CREATE VIEW v_contested_verdicts AS
SELECT code, name, contested_note, uses, mean_score, lift_vs_all,
       CASE WHEN uses < 6 THEN 'not enough data'
            WHEN lift_vs_all > 0.15 THEN 'CONFIRMED for your audience'
            WHEN lift_vs_all < -0.15 THEN 'REJECTED for your audience'
            ELSE 'no measurable effect' END AS verdict
FROM v_technique_performance
WHERE contested ORDER BY uses DESC;
