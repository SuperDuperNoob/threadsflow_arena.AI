# ThreadsFlow Guide Index

This folder contains the persisted outputs from the Documentation & Architecture Library Audit and zero-credential deployment readiness pass.

## Files

1. [`00-audit-summary.md`](00-audit-summary.md) — file-by-file audit outcome for every pre-existing Markdown file in scope, including updates and no-change files.
2. [`01-credential-sourcing.md`](01-credential-sourcing.md) — code-derived credential/account inventory, Tier A/B/C classification, and zero-to-credential sourcing table.
3. [`02-preflight-checklist.md`](02-preflight-checklist.md) — ordered first-time-user checklist from no accounts/secrets to agent-ready deployment.
4. [`03-agent-readiness-gate.md`](03-agent-readiness-gate.md) — copy-paste preflight gate that verifies required `.env` and DB-held secrets before deployment/activation.

## Open Questions / Code Mismatches Found

Re-verified 2026-08-01 against current `main` (after commits `46ae8d1` and `464300e`). These were
not guessed around; they are documented as current live-code mismatches:

1. **~~System Settings Control Board not present~~ — RESOLVED.** `/settings.html` is now a 6-tab
   board. The LLM tab still uses `/api/config/llm`; the other five (`posting`, `bandit`, `qa`,
   `l4_reply`, `warmup`) plus `scoring` use the generic `GET/PUT /api/config/system/:key` route,
   allowlisted in `services/kb/server.js:238` and validated per-key in `services/kb/server.js:240-273`.
2. **Video/mixed publishing is not wired.** Migration 020 and `bandit.js` support `VIDEO` and `MIXED_CAROUSEL`, but `wf3_publish.json` does not have video/mixed branches, `video_url` parameters, or async status polling before `threads_publish`.
3. **Browser product page does not expose video upload.** The backend `POST /api/products` accepts MP4/MOV, but `services/kb/public/product.html` accepts only JPG/PNG and caps uploads at 4 images.
4. **~~L4 token key mismatch~~ — RESOLVED.** `scripts/set_secrets.sh:135-141` now writes
   `settings.l4_reply.threads_token` directly, matching `wf7_l4_reply.json:234`.
5. **Shopee DB key mismatch in helper — PARTIALLY resolved.** `scripts/set_secrets.sh --shopee-*`
   now writes a `shopee_app_id` row (`scripts/set_secrets.sh:150-156`), matching
   `services/kb/lib/shopee.js:58`. But it never writes a separate `shopee_app_secret` row, so
   `readSetting('shopee_app_secret')` (`shopee.js:59`) still finds nothing via the settings table —
   the secret is only reachable through the `SHOPEE_API_SECRET` env var today.
6. **L4 comment ingestion source is incomplete.** `wf7_l4_reply.json` reads local `threads_comments`; it does not fetch Threads replies itself. A separate ingestion path must populate `threads_comments` before L4 can reply.
7. **Text variation is dormant.** Migration 015 and `n8n/code/text_variation.js` exist, but current workflow JSONs do not call that helper or log `text_variations`.
8. **Video vision skip is not cleanly wired.** `describeImage(publicUrl, mediaKind)` can skip `VIDEO`, but `services/kb/server.js` currently calls `describeImage(im.public_url)` without selecting/passing `media_kind`.
9. **Cosmetic: stale log message in `set_secrets.sh`.** After writing both `threads_creds` and `l4_reply.threads_token` correctly, the script prints `"threads_creds + l4_config updated"` (`scripts/set_secrets.sh:141`) — `l4_config` is a leftover from before the key was renamed to `l4_reply`. Functionally harmless (the SQL writes the right key), but the operator-facing message is wrong and should say `l4_reply`.

Treat items 2, 3, 5 (partial), 6, 7, and 8 as engineering follow-up items before claiming full
Phase 1/Phase 2 completion.
