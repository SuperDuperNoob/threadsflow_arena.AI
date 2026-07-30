-- Migration 008 — shared LLM config row.
--
-- n8n generation reads settings.llm, while the KB service can now read the same row for
-- PDF mining, product enrichment and embeddings. Existing custom values win; this migration
-- only fills missing keys and changes the out-of-the-box default to hosted 9router.

BEGIN;

INSERT INTO settings (key, value) VALUES
('llm', '{
  "base_url": "https://9router.archxry.space/v1",
  "api_key": "",
  "model_write": "gemini-2.5-flash",
  "model_edit": "gpt-4.1-mini",
  "model_embed": "text-embedding-3-small",
  "model_mine": "gemini-2.5-pro"
}'::jsonb)
ON CONFLICT (key) DO UPDATE SET
  value = '{
    "base_url": "https://9router.archxry.space/v1",
    "api_key": "",
    "model_write": "gemini-2.5-flash",
    "model_edit": "gpt-4.1-mini",
    "model_embed": "text-embedding-3-small",
    "model_mine": "gemini-2.5-pro"
  }'::jsonb || settings.value;

COMMIT;
