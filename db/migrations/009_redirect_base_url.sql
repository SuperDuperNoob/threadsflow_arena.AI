-- Migration 009 — public redirector base URL default for generated CTA comments.
--
-- Replace https://r.yourdomain.com in settings.posting or set PUBLIC_REDIRECT_BASE in Docker
-- before going live. This default is only a safe placeholder for fresh installs.

BEGIN;

INSERT INTO settings (key, value) VALUES
('posting', '{"redirect_base_url":"https://r.yourdomain.com"}'::jsonb)
ON CONFLICT (key) DO UPDATE SET
  value = CASE
    WHEN settings.value ? 'redirect_base_url' THEN settings.value
    ELSE jsonb_set(settings.value, '{redirect_base_url}', '"https://r.yourdomain.com"'::jsonb)
  END;

COMMIT;
