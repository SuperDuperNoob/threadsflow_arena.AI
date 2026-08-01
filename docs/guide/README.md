# ThreadsFlow Guide Index

This folder contains the persisted outputs from the Documentation & Architecture Library Audit and zero-credential deployment readiness pass.

## Files

1. [`00-audit-summary.md`](00-audit-summary.md) — file-by-file audit outcome for every pre-existing Markdown file in scope, including updates and no-change files.
2. [`01-credential-sourcing.md`](01-credential-sourcing.md) — code-derived credential/account inventory, Tier A/B/C classification, and zero-to-credential sourcing table.
3. [`02-preflight-checklist.md`](02-preflight-checklist.md) — ordered first-time-user checklist from no accounts/secrets to agent-ready deployment.
4. [`03-agent-readiness-gate.md`](03-agent-readiness-gate.md) — copy-paste preflight gate that verifies required `.env` and DB-held secrets before deployment/activation.

## Open Questions / Code Mismatches Found

These were not guessed around; they are documented as current live-code mismatches:

1. **System Settings Control Board not present.** `/settings.html` is currently an LLM-only settings page using `/api/config/llm`. There is no five-tab control board and no `PUT /api/config/system/:key` route in `services/kb/server.js`.
2. **Video/mixed publishing is not wired.** Migration 020 and `bandit.js` support `VIDEO` and `MIXED_CAROUSEL`, but `wf3_publish.json` does not have video/mixed branches, `video_url` parameters, or async status polling before `threads_publish`.
3. **Browser product page does not expose video upload.** The backend `POST /api/products` accepts MP4/MOV, but `services/kb/public/product.html` accepts only JPG/PNG and caps uploads at 4 images.
4. **L4 token key mismatch.** `scripts/set_secrets.sh` writes `settings.l4_config.threads_token`, but `wf7_l4_reply.json` reads `settings.l4_reply.threads_token`.
5. **Shopee DB key mismatch in helper.** Shopee code reads env vars or `settings` rows `shopee_app_id` / `shopee_app_secret`; `scripts/set_secrets.sh --shopee-*` writes a `settings.shopee` row instead.
6. **L4 comment ingestion source is incomplete.** `wf7_l4_reply.json` reads local `threads_comments`; it does not fetch Threads replies itself. A separate ingestion path must populate `threads_comments` before L4 can reply.
7. **Text variation is dormant.** Migration 015 and `n8n/code/text_variation.js` exist, but current workflow JSONs do not call that helper or log `text_variations`.
8. **Video vision skip is not cleanly wired.** `describeImage(publicUrl, mediaKind)` can skip `VIDEO`, but `services/kb/server.js` currently calls `describeImage(im.public_url)` without selecting/passing `media_kind`.

Treat these as engineering follow-up items before claiming full Phase 1/Phase 2 completion.
