-- Knowledge Base service — PDF ingestion, dedup, and technique extraction.
-- Run after schema.sql and schema_techniques.sql.

-- ─────────────────────────────────────────── documents

CREATE TABLE kb_documents (
  id             BIGSERIAL PRIMARY KEY,
  filename       TEXT NOT NULL,
  title          TEXT,                       -- from PDF metadata or first-page LLM guess
  author         TEXT,
  bytes          BIGINT,
  pages          INT,

  -- THREE dedup keys, checked in this order (cheap → expensive):
  sha256         TEXT UNIQUE NOT NULL,       -- 1. exact same file
  text_sha256    TEXT,                       -- 2. same text, different file (re-export, OCR pass)
  simhash        BIGINT,                     -- 3. near-duplicate (different edition/scan)

  char_count     INT,
  lang           TEXT,
  status         TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','extracting','chunking','mining','merging',
                                   'done','failed','duplicate','rejected')),
  progress       NUMERIC DEFAULT 0,          -- 0..1 for the UI progress bar
  stage_note     TEXT,
  error          TEXT,
  duplicate_of   BIGINT REFERENCES kb_documents(id),

  techniques_found     INT DEFAULT 0,
  techniques_new       INT DEFAULT 0,
  techniques_merged    INT DEFAULT 0,
  techniques_rejected  INT DEFAULT 0,
  banned_added         INT DEFAULT 0,
  levers_added         INT DEFAULT 0,

  source_id      BIGINT REFERENCES technique_sources(id),
  storage_path   TEXT,                       -- where the original PDF lives (optional keep)
  uploaded_at    TIMESTAMPTZ DEFAULT now(),
  finished_at    TIMESTAMPTZ
);
CREATE INDEX ON kb_documents (status);
CREATE INDEX ON kb_documents (simhash);

-- ─────────────────────────────────────────── chunks
-- Kept so you can re-run mining with a better prompt without re-parsing the PDF.

CREATE TABLE kb_chunks (
  id           BIGSERIAL PRIMARY KEY,
  document_id  BIGINT REFERENCES kb_documents(id) ON DELETE CASCADE,
  ord          INT NOT NULL,
  page_from    INT,
  page_to      INT,
  text         TEXT NOT NULL,
  char_count   INT,
  sha256       TEXT,                          -- chunk-level dedup across documents
  mined        BOOLEAN DEFAULT false,
  yield        INT DEFAULT 0,                 -- techniques produced by this chunk
  UNIQUE (document_id, ord)
);
CREATE INDEX ON kb_chunks (document_id, mined);
CREATE INDEX ON kb_chunks (sha256);

-- ─────────────────────────────────────────── candidates (pre-dedup staging)
-- Every extraction lands here first. Merging into `techniques` is a separate, reviewable step,
-- so a bad mining run never corrupts the live library.

CREATE TABLE kb_candidates (
  id             BIGSERIAL PRIMARY KEY,
  document_id    BIGINT REFERENCES kb_documents(id) ON DELETE CASCADE,
  chunk_id       BIGINT REFERENCES kb_chunks(id) ON DELETE CASCADE,
  code           TEXT,
  name           TEXT,
  type           TEXT,
  instruction    TEXT,
  when_to_use    TEXT,
  mechanism      TEXT,
  example_do     TEXT,
  example_dont   TEXT,
  compatible_formats   TEXT[] DEFAULT '{}',
  compatible_tones     TEXT[] DEFAULT '{}',
  compatible_intensity SMALLINT[] DEFAULT '{}',
  contested      BOOLEAN DEFAULT false,
  contested_note TEXT,
  regex          TEXT,
  embedding      REAL[],
  quote          TEXT,                        -- the source sentence, for your spot-checks

  validation     JSONB DEFAULT '[]',          -- list of problems found by the validator
  disposition    TEXT DEFAULT 'pending'
                 CHECK (disposition IN ('pending','inserted','merged','rejected','needs_review')),
  merged_into    BIGINT REFERENCES techniques(id),
  similarity     NUMERIC,                     -- cosine against the technique it merged with
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON kb_candidates (document_id, disposition);

-- Techniques get provenance + an embedding so future dedup is possible
ALTER TABLE techniques ADD COLUMN IF NOT EXISTS embedding REAL[];
ALTER TABLE techniques ADD COLUMN IF NOT EXISTS document_ids BIGINT[] DEFAULT '{}';
ALTER TABLE techniques ADD COLUMN IF NOT EXISTS corroboration INT DEFAULT 1;
ALTER TABLE techniques ADD COLUMN IF NOT EXISTS quote TEXT;
ALTER TABLE techniques ADD COLUMN IF NOT EXISTS review_state TEXT DEFAULT 'auto'
  CHECK (review_state IN ('auto','approved','rejected'));

COMMENT ON COLUMN techniques.corroboration IS
  'How many distinct source documents assert this. 3 books agreeing is a much stronger prior '
  'than 1 book asserting. Used as an exploration bonus in technique_picker.js.';

-- ─────────────────────────────────────────── job queue
-- In-Postgres queue. No Redis: you do not have the RAM, and throughput is ~1 PDF/hour.

CREATE TABLE kb_jobs (
  id           BIGSERIAL PRIMARY KEY,
  document_id  BIGINT REFERENCES kb_documents(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'ingest',
  state        TEXT NOT NULL DEFAULT 'pending'
               CHECK (state IN ('pending','running','done','failed')),
  attempts     INT DEFAULT 0,
  locked_at    TIMESTAMPTZ,
  locked_by    TEXT,
  last_error   TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON kb_jobs (state, created_at);

-- ─────────────────────────────────────────── views

CREATE VIEW v_kb_library AS
SELECT d.id, d.filename, d.title, d.author, d.pages, d.status, d.progress,
       d.techniques_new, d.techniques_merged, d.techniques_rejected,
       d.banned_added, d.levers_added, d.uploaded_at, d.finished_at,
       round(EXTRACT(EPOCH FROM (d.finished_at - d.uploaded_at))) AS seconds,
       dup.filename AS duplicate_of_file
FROM kb_documents d
LEFT JOIN kb_documents dup ON dup.id = d.duplicate_of
ORDER BY d.uploaded_at DESC;

-- Which books agree with each other? High corroboration = trustworthy prior.
CREATE VIEW v_kb_corroboration AS
SELECT t.code, t.name, t.type, t.corroboration,
       array_agg(DISTINCT d.title) FILTER (WHERE d.title IS NOT NULL) AS sources,
       t.n AS times_used, round(t.reward_sum / NULLIF(t.n,0), 3) AS mean_reward
FROM techniques t
LEFT JOIN kb_documents d ON d.id = ANY(t.document_ids)
GROUP BY t.id, t.code, t.name, t.type, t.corroboration, t.n, t.reward_sum
ORDER BY t.corroboration DESC, mean_reward DESC NULLS LAST;
