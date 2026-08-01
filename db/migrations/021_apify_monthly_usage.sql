-- Migration 021: strict per-calendar-month Apify run budget.
-- The KB service reserves a run atomically before calling Apify, so concurrent workers cannot
-- exceed APIFY_MONTHLY_MAX_RUNS. Failed runs remain counted because they can still be billable.

CREATE TABLE IF NOT EXISTS apify_monthly_usage (
  month DATE PRIMARY KEY,
  runs INTEGER NOT NULL DEFAULT 0 CHECK (runs >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO run_log (workflow, level, message)
VALUES ('migration', 'info', 'Migration 021: Apify monthly usage budget');
