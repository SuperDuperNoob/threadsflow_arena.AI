# Documentation & Architecture Audit Summary

Audit date: 2026-08-01. Re-verified 2026-08-01 (later same day, after commits `46ae8d1`
"fix(credentials): canonicalize Shopee + L4 token keys" and `464300e` "feat(settings): implement
System Settings Control Board" landed on `main`). The re-verification pass re-read the live code
for every claim these two commits could have changed and updated the affected doc rows below plus
the corresponding source files (`README.md`, `docs/00-START-HERE.md`, `docs/01-architecture.md`,
`docs/03-setup-runbook.md`, `docs/07-l4-reply-loop.md`, `docs/09-wf6-l4-improvements.md`,
`docs/11-quick-start.md`, `docs/14-agent-autonomous-deploy.md`, `docs/guide/README.md`,
`docs/guide/02-preflight-checklist.md`). Findings:

**Refresh pass: 2026-08-01 (against `main` at `5f94ba2`, covering commits `e4e7b53`
"fix(scripts): write shopee_app_secret row in set_secrets.sh" and `2bef5af`
"fix(kb): pass media_kind to describeImage()").** This refresh re-read the live code for every
claim these two commits could have changed and updated the affected doc rows below. Findings:

- **Settings Control Board: now live.** `/settings.html` has 6 tabs; 5 of them (`posting`, `bandit`,
  `qa`, `l4_reply`, `warmup`) plus `scoring` read/write through `GET/PUT /api/config/system/:key`
  (`services/kb/server.js:238`, `275-300`). Confirmed by reading the route handlers and the
  allowlist directly — not inferred from the commit message.
- **L4 token key mismatch: fixed.** `scripts/set_secrets.sh` now writes `l4_reply.threads_token`
  directly (`scripts/set_secrets.sh:135-141`), matching `wf7_l4_reply.json:234`. Confirmed by
  reading both files.
- **Shopee key mismatch: fixed.** `scripts/set_secrets.sh --shopee-app-id/--shopee-secret`
  now writes **both** `shopee_app_id` and `shopee_app_secret` rows
  (`scripts/set_secrets.sh:150-161`), matching `services/kb/lib/shopee.js:58-59`.
  The DB path now works alongside env vars.
- **Video vision skip: fixed.** `services/kb/server.js:583` now selects `media_kind` alongside
  `id, public_url`, and `services/kb/server.js:585` passes it through as
  `describeImage(im.public_url, im.media_kind)`, so `VIDEO` rows skip the vision call
  as designed. Covered by `services/kb/lib/products.test.js`.
- **Still open, unchanged by either commit** (re-confirmed against current code): VIDEO/MIXED_CAROUSEL
  routing absent from `wf3_publish.json`; browser `product.html` still JPG/PNG-only, 4-image cap;
  no workflow inserts into `threads_comments` (L4 ingestion gap); `text_variation.js` still uncalled
  by any workflow; `describeImage()` still called without a `media_kind` argument for back-compat.

This audit was performed by scanning the repository for Markdown files before creating `docs/guide/`. The pre-existing Markdown scope was:

```text
AGENTS.md
Books/Threads_Affiliate_Marketing_2026_Strategies.md
README.md
docs/00-START-HERE.md
docs/01-architecture.md
docs/02-n8n-workflows.md
docs/03-setup-runbook.md
docs/04-technique-library.md
docs/05-books.md
docs/06-persona-warmup.md
docs/07-l4-reply-loop.md
docs/08-72h-canary.md
docs/09-wf6-l4-improvements.md
docs/10-malaysian-dataset.md
docs/11-quick-start.md
docs/12-text-variation.md
docs/13-review-queue.md
docs/14-agent-autonomous-deploy.md
docs/TEXT_VARIATION_SUMMARY.md
n8n/workflows/wf6_karma.spec.md
prompts/cta.md
prompts/editor.md
prompts/persona_writer.md
prompts/reply_assistant.md
prompts/technique_extractor.md
prompts/writer.md
```

The `docs/guide/*.md` files were generated after discovery as the requested persisted outputs.

## Source-of-truth highlights

| Area | Ground truth found in code |
|---|---|
| Media schema | Migration 020 adds `posts.media_type IN ('TEXT','IMAGE','CAROUSEL','VIDEO','MIXED_CAROUSEL')`, `posts_media_consistency_chk` for the five values, and `product_images.media_kind IN ('IMAGE','VIDEO')` (`db/migrations/020_video_mixed_carousel.sql:9-37`). |
| Media intake | Server accepts image/jpeg, image/png, image/webp, video/mp4, video/quicktime with a 20-file limit and inserts `media_kind` (`services/kb/server.js:400-409`, `436-489`). Browser `/product.html` still accepts only JPG/PNG and caps at 4 images (`services/kb/public/product.html:88-112`). |
| Media generation | `wf2_generate` loads image/video counts and picks assets by `product_images.media_kind` (`n8n/workflows/wf2_generate.json:27`, `88`). `n8n/code/bandit.js` can choose `VIDEO` and `MIXED_CAROUSEL` for media-capable products (`n8n/code/bandit.js:180-198`). |
| Publishing | `wf3_publish.json` currently has route branches for `TEXT`, image-only `CAROUSEL`, and fallback `IMAGE`; there are no `VIDEO` / `MIXED_CAROUSEL` nodes and no status polling loop (node list/route in `n8n/workflows/wf3_publish.json`; `Route by media type`, `Create IMAGE container`, `Create carousel items`, `Create CAROUSEL container`, `Wait for media processing`). |
| Settings UI | Full Control Board: LLM tab + 5 dynamic tabs (posting, bandit, qa, l4_reply, warmup) served by generalized `/api/config/system/:key` routes with validation & auth, allowlisted to `{posting, bandit, qa, l4_reply, warmup, scoring}` (`services/kb/server.js:238`, `275-300`, `240-273`). Original LLM contract unchanged. See STEP0_GROUND_TRUTH.md. |
| Settings keys | Live workflow/service keys include `llm`, `qa`, `posting`, `bandit`, `scoring`, `warmup`, `l4_reply`, `next_cycle_plan`, `threads_creds`, `text_variation`, `locale`, `redirect_base_url`, and Shopee rows (`db/seed_levers_my.sql:131-158`; migrations 008/010/011/015/017; workflows grep). |
| L4 reply | `wf7_l4_reply` loads `settings.l4_reply`, reads local `threads_comments`, publishes replies with `settings.l4_reply.threads_token`, and writes `l4_replies` (`n8n/workflows/wf7_l4_reply.json:20`, `56`, `70`, `233-285`). |
| Token helper mismatch | **Resolved.** `scripts/set_secrets.sh` writes `threads_creds` and `l4_reply.threads_token` in the same call (`scripts/set_secrets.sh:135-141`), matching what `wf7_l4_reply` reads (`n8n/workflows/wf7_l4_reply.json:233-234`). |
| Shopee key mismatch | **Resolved.** Shopee code reads env vars then `settings` rows `shopee_app_id` / `shopee_app_secret` (`services/kb/lib/shopee.js:14-18`, `58-59`). `scripts/set_secrets.sh --shopee-*` now writes **both** `shopee_app_id` and `shopee_app_secret` rows (`scripts/set_secrets.sh:150-161`), so the DB path works in addition to env vars. |
| Text variation | Migration and helper exist, but no workflow JSON contains active Text Variation nodes (`db/migrations/015_text_variation_settings.sql`; `n8n/code/text_variation.js`; grep of `n8n/workflows/*.json`). |
| Deployment env | Required service env and secrets are defined in `.env.example` and consumed by compose (`infra/.env.example:1-140`; `infra/docker-compose.yml:21-203`). |
| Vision skip | `describeImage()` accepts optional `mediaKind` param and returns `null` for `VIDEO`; server query now selects and passes `media_kind` (`services/kb/server.js:583`, `585`); unit tests cover back-compat and VIDEO skip (`services/kb/lib/products.test.js`). |

## File-by-file outcome

| File | Outcome | Dimensions checked and result |
|---|---|---|
| `README.md` | **Updated (re-verified)** | Original pass added media/settings corrections. Re-verification pass replaced the now-stale "LLM endpoint settings page only" claim with the live 6-tab Control Board description. Traceable to `services/kb/server.js:238`, `275-300`. |
| `docs/00-START-HERE.md` | **Updated (re-verified)** | Original pass added media-aware language and migration count. Re-verification pass replaced the "not present" Control Board claim with the live tab list, allowlist, and validation rules. Traceable to `services/kb/server.js:238-300`. |
| `docs/01-architecture.md` | **Updated (re-verified)** | Original pass rebuilt the component map and media lever set. Re-verification pass replaced the "not present" `/api/config/system/:key` note with the live route description, allowlist, and per-key validation rules. Traceable to `services/kb/server.js:238-300`. |
| `docs/02-n8n-workflows.md` | **Updated** | Corrected workflow inventory; removed obsolete n8n credential guidance; updated intake shapes; updated media gating; documented `settings.qa` actually loaded vs directly used; corrected wf3 fetch status and route graph; added explicit VIDEO/MIXED gap and required future polling loop. Traceable to `bootstrap_n8n.sh`, `wf2_generate.json`, `wf3_publish.json`, `n8n/code/qa.js`. |
| `docs/03-setup-runbook.md` | **Updated (re-verified)** | Original pass corrected container/migration counts and added an L4 token workaround. Re-verification pass removed that now-obsolete workaround (the script writes the correct key directly) and replaced the "LLM-only settings, Control Board absent" claim with the live 6-tab description. Traceable to `scripts/set_secrets.sh:135-141`, `services/kb/server.js:238-300`. |
| `docs/04-technique-library.md` | **No changes required** | Checked technique-library descriptions against `db/schema_techniques.sql`, `services/kb/server.js` upload/mining routes, and KB worker convention. No media/settings/schema enum claims requiring change. |
| `docs/05-books.md` | **No changes required** | Checked book-mining and anti-pattern discussion against seed/migration files and prompts. Existing claims are historical/technique-library oriented; no Phase 1/2 media/settings claims found. |
| `docs/06-persona-warmup.md` | **Updated** | Added L4 token caveat because current `wf7_l4_reply` expects `settings.l4_reply.threads_token`. Other persona warm-up flow remained aligned with `wf6_persona.json`, `persona_slot_plan.js`, `qa_persona.js`, and migration 010. |
| `docs/07-l4-reply-loop.md` | **Updated (re-verified)** | Original pass documented the comment-ingestion gap and token mismatch (ingestion gap re-confirmed still open). Re-verification pass marked the token mismatch resolved now that `set_secrets.sh` writes the matching key. Traceable to `scripts/set_secrets.sh:135-141`; ingestion gap re-confirmed by grepping all workflow JSON for `INSERT INTO threads_comments` (no matches). |
| `docs/08-72h-canary.md` | **Updated** | Changed prerequisite wording from image hosting to media hosting. Checked logging/redaction claims against compose log rotation and logger usage; no further media/settings corrections needed. |
| `docs/09-wf6-l4-improvements.md` | **Updated** | Rewrote stale implementation summary. Corrected `settings.l4_reply.enabled` default, noted `wf7_l4_reply.json` exists, documented `persona_topic_feedback` as schema groundwork not active wf4 updates, and documented token mismatch. Traceable to migration 011, wf6/wf7 JSON, `scripts/bootstrap_n8n.sh`, `scripts/set_secrets.sh`. |
| `docs/10-malaysian-dataset.md` | **No changes required** | Checked dataset/persona snippet claims against migration 012 and persona views. No media/settings/deployment instructions present. |
| `docs/11-quick-start.md` | **Updated** | Corrected migration count to 001–020; added media schema/browser/video publishing/settings UI status rows; replaced manual update-workflow instructions with `bootstrap_n8n.sh` path and L4 token caveat. Traceable to migrations, workflow JSONs, and bootstrap script. |
| `docs/12-text-variation.md` | **Updated** | Rewrote from active-feature claim to current status: migration/helper exist, workflows are not wired. Traceable to migration 015, `n8n/code/text_variation.js`, and lack of workflow nodes. |
| `docs/13-review-queue.md` | **No changes required** | Checked review queue claims against `services/kb/server.js` review routes, migration 017/019 `post_review`, and `n8n/code/scoring.js` human feedback. No Phase 1/2 media/settings claims required edits. |
| `docs/14-agent-autonomous-deploy.md` | **Updated** | Reframed zero-credential autonomy; linked `docs/guide`; expanded human-gated credential set beyond “four credentials”; added current video/mixed publisher caveat. Traceable to env/compose/scripts and workflow audit. |
| `docs/TEXT_VARIATION_SUMMARY.md` | **Updated** | Rewrote to align with dormant text-variation implementation. Traceable to migration 015, helper file, and workflow JSON audit. |
| `AGENTS.md` | **No changes required** | Checked repository guidance and domain standards. It does not enumerate media modes, settings surfaces, deployment credentials, or workflow node specs. |
| `Books/Threads_Affiliate_Marketing_2026_Strategies.md` | **No changes required** | Checked as content-source/strategy material, not architecture or operator runbook. No schema/API/settings claims. |
| `n8n/workflows/wf6_karma.spec.md` | **No changes required** | Checked as draft-only spec. It already states official public search/third-party commenting are unavailable and remains marked future/draft. |
| `prompts/cta.md` | **No changes required** | Prompt text checked; no architecture/schema/UI/deployment claims. |
| `prompts/editor.md` | **No changes required** | Prompt text checked; no architecture/schema/UI/deployment claims. |
| `prompts/persona_writer.md` | **No changes required** | Prompt text checked against persona workflow. It is for TEXT-only persona posts, which matches `wf6_persona`. |
| `prompts/reply_assistant.md` | **No changes required** | Prompt text checked against L4 reply logic. No media/schema/settings-surface claims. |
| `prompts/technique_extractor.md` | **No changes required** | Prompt text checked; it describes technique extraction for Threads/Shopee and does not enumerate current media/settings/deployment surfaces. |
| `prompts/writer.md` | **No changes required** | Prompt uses templated media lever labels and does not hard-code stale media enum values. |

## Generated guide files

| File | Purpose |
|---|---|
| `docs/guide/README.md` | Index and open questions. |
| `docs/guide/01-credential-sourcing.md` | Zero-to-credential sourcing table and Tier A/B/C classification. |
| `docs/guide/02-preflight-checklist.md` | Ordered human checklist before agent handoff. |
| `docs/guide/03-agent-readiness-gate.md` | Copy-paste preflight script and stop conditions. |

## Verification performed

- Enumerated Markdown scope with `find . -name '*.md'` before creating guide files.
- Grepped code for media/settings/workflow/deployment references.
- Inspected source files for schema/migrations, route handlers, UI forms, workflow node names, and deployment scripts.
- Re-ran grep checks for stale `TEXT, IMAGE, CAROUSEL`-only claims, stale migration counts, and unsupported System Settings Control Board claims.
- Ran a Markdown link/code-fence sanity script after edits (see session log).
- **Refresh pass:** re-read `services/kb/server.js`, `scripts/set_secrets.sh`, `n8n/workflows/wf3_publish.json`, `n8n/code/bandit.js`, `services/kb/public/product.html`, `n8n/workflows/wf7_l4_reply.json`, `services/kb/lib/shopee.js`, `services/kb/lib/products.test.js` against commits `e4e7b53` and `2bef5af`.
