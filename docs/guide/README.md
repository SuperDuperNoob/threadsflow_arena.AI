# ThreadsFlow Guide Index

This folder contains the persisted outputs from the Documentation & Architecture Library Audit and zero-credential deployment readiness pass.

## Files

1. [`00-audit-summary.md`](00-audit-summary.md) — file-by-file audit outcome for every pre-existing Markdown file in scope, including updates and no-change files.
2. [`01-credential-sourcing.md`](01-credential-sourcing.md) — code-derived credential/account inventory, Tier A/B/C classification, and zero-to-credential sourcing table.
3. [`02-preflight-checklist.md`](02-preflight-checklist.md) — ordered first-time-user checklist from no accounts/secrets to agent-ready deployment.
4. [`03-agent-readiness-gate.md`](03-agent-readiness-gate.md) — copy-paste preflight gate that verifies required `.env` and DB-held secrets before deployment/activation.

## Open Questions / Code Mismatches Found

Re-verified 2026-08-01 against current `main` (at commit `5f94ba2`, after commits `e4e7b53`
"fix(scripts): write shopee_app_secret row in set_secrets.sh" and `2bef5af`
"fix(kb): pass media_kind to describeImage()"). These were
not guessed around; they are documented as current live-code mismatches:

1. **~~System Settings Control Board not present~~ — RESOLVED.** `/settings.html` is now a 6-tab
   board. The LLM tab still uses `/api/config/llm`; the other five (`posting`, `bandit`, `qa`,
   `l4_reply`, `warmup`) plus `scoring` use the generic `GET/PUT /api/config/system/:key` route,
   allowlisted in `services/kb/server.js:238` and validated per-key in `services/kb/server.js:240-273`.
2. **Video/mixed publishing is not wired.** Migration 020 and `bandit.js` support `VIDEO` and `MIXED_CAROUSEL`, but `wf3_publish.json` does not have video/mixed branches, `video_url` parameters, or async status polling before `threads_publish`.
3. **Browser product page does not expose video upload.** The backend `POST /api/products` accepts MP4/MOV, but `services/kb/public/product.html` accepts only JPG/PNG and caps uploads at 4 images.
4. **~~L4 token key mismatch~~ — RESOLVED.** `scripts/set_secrets.sh:135-141` now writes
   `settings.l4_reply.threads_token` directly, matching `wf7_l4_reply.json:234`.
5. **~~Shopee DB key mismatch in helper~~ — RESOLVED.** `scripts/set_secrets.sh --shopee-*`
   now writes **both** `shopee_app_id` and `shopee_app_secret` rows
   (`scripts/set_secrets.sh:150-161`), matching `services/kb/lib/shopee.js:58-59`.
   The DB path now works alongside env vars.
6. **L4 comment ingestion source is incomplete.** `wf7_l4_reply.json` reads local `threads_comments`; it does not fetch Threads replies itself. A separate ingestion path must populate `threads_comments` before L4 can reply.
7. **Text variation is dormant.** Migration 015 and `n8n/code/text_variation.js` exist, but current workflow JSONs do not call that helper or log `text_variations`.
8. **~~Video vision skip is not cleanly wired~~ — RESOLVED.** `services/kb/server.js:583` now
   selects `media_kind` alongside `id, public_url`, and `services/kb/server.js:585` passes it
   through as `describeImage(im.public_url, im.media_kind)`, so `VIDEO` rows skip the vision call
   as designed. Covered by `services/kb/lib/products.test.js`.
9. **~~Cosmetic: stale log message in `set_secrets.sh`~~ — RESOLVED.** The script now prints
   `"threads_creds + l4_reply updated"` (`scripts/set_secrets.sh:141`), matching the keys the SQL
   actually writes.
10. **Persona Jupyter notebooks unreferenced.** `persona/dataset-2.ipynb` through `dataset-10.ipynb` (9 notebooks) exist in the tree with no reference from any script or doc. `docs/10-malaysian-dataset.md` only documents the older, already-deleted `persona/dataset-1.json`. Not a doc/code contradiction (nothing claims the directory is empty) — flagged as an unverifiable Open Question until a script or doc actually references them.

Treat items 2, 3, 6, 7, and 10 as engineering follow-up items before claiming full
Phase 1/Phase 2 completion.
