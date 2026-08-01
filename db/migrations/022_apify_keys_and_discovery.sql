-- Multiple rotating Apify credentials and keyword discovery history.
CREATE TABLE IF NOT EXISTS apify_api_keys (
  id BIGSERIAL PRIMARY KEY,
  label TEXT NOT NULL,
  token TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 100,
  disabled_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS apify_api_keys_label_unique ON apify_api_keys (lower(label));

CREATE TABLE IF NOT EXISTS apify_key_monthly_usage (
  key_id BIGINT NOT NULL REFERENCES apify_api_keys(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  runs INTEGER NOT NULL DEFAULT 0 CHECK (runs >= 0),
  PRIMARY KEY (key_id, month)
);

CREATE TABLE IF NOT EXISTS product_research_runs (
  id BIGSERIAL PRIMARY KEY,
  keyword TEXT NOT NULL,
  sort TEXT NOT NULL DEFAULT 'sales',
  max_products INTEGER NOT NULL CHECK (max_products BETWEEN 1 AND 20),
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','budget_blocked')),
  candidate_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS product_research_candidates (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES product_research_runs(id) ON DELETE CASCADE,
  shop_id BIGINT, item_id BIGINT, product_url TEXT NOT NULL, title TEXT,
  image_url TEXT, currency TEXT, price NUMERIC, original_price NUMERIC,
  discount_pct INTEGER, rating NUMERIC, rating_count INTEGER, sold_count INTEGER,
  location TEXT, is_mall BOOLEAN, opportunity_score NUMERIC,
  UNIQUE (run_id, shop_id, item_id)
);
CREATE TABLE IF NOT EXISTS product_research_snapshots (
  id BIGSERIAL PRIMARY KEY,
  shop_id BIGINT NOT NULL, item_id BIGINT NOT NULL, captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  price NUMERIC, rating NUMERIC, rating_count INTEGER, sold_count INTEGER
);
CREATE INDEX IF NOT EXISTS product_research_snapshots_product_idx ON product_research_snapshots(shop_id, item_id, captured_at DESC);
