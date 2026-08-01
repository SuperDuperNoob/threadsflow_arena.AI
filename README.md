# ThreadsFlow

**Self-improving Shopee-affiliate posting system for Threads. Malaysian Malay, RM, KL time.**

**What you do:** paste a Shopee affiliate link, optionally the full product URL for enrichment,
plus browser-uploaded product images (JPG/PNG), API-uploaded media (JPG/PNG/WebP/MP4/MOV),
or a written description.
**What it does:** writes posts in everyday Malay (a different style every time), posts 5×/day,
puts the tracked link in the first comment, counts clicks and sales, and every 3 days shifts
more posting slots to whatever actually made money. Runs until you stop it.

**New?** Start with **[`docs/guide/README.md`](docs/guide/README.md)** for the audit-backed credential sourcing and preflight gate, then **[`docs/11-quick-start.md`](docs/11-quick-start.md)** for setup commands, **[`docs/00-START-HERE.md`](docs/00-START-HERE.md)** for the plain-language overview, and **[`docs/03-setup-runbook.md`](docs/03-setup-runbook.md)** for click-by-click setup.

---

## 🚀 Quick Start

### New VPS (Fresh Installation)
```bash
curl -sSL https://raw.githubusercontent.com/SuperDuperNoob/threadsflow_arena.AI/main/scripts/setup_new_vps.sh | sudo bash
```

### Existing VPS (Update to Latest)
```bash
cd /path/to/threadsflow_arena.AI
./scripts/update_existing_vps.sh
```

**Full guide:** [`docs/11-quick-start.md`](docs/11-quick-start.md)

---

## Current implementation status

Ground truth from the current codebase:

- **Media data model:** `posts.media_type` now allows five values after migration 020: `TEXT`, `IMAGE`, `CAROUSEL`, `VIDEO`, and `MIXED_CAROUSEL`; `product_images.media_kind` distinguishes `IMAGE` from `VIDEO`.
- **Browser intake:** `/product.html` currently exposes JPG/PNG uploads only. The backend `POST /api/products` accepts JPG, PNG, WebP, MP4, and MOV under the `images` multipart field.
- **Publishing:** the imported `wf3_publish.json` currently routes only `TEXT`, `IMAGE`, and image-only `CAROUSEL`. It does **not** yet have dedicated `VIDEO` or `MIXED_CAROUSEL` Threads container/polling nodes, so do not enable video media levers for live publishing until that workflow is extended.
- **Settings UI:** `/settings.html` is a tabbed System Settings Control Board. The LLM tab is backed by `/api/config/llm`; the Posting Schedule, Bandit / Scoring, Content / QA, Auto-Reply Loop, and Warmup tabs are backed by the generic `GET/PUT /api/config/system/:key` route, restricted to the `posting, bandit, qa, l4_reply, warmup, scoring` allowlist so secret rows (e.g. `threads_creds`) are never exposed.

## Why this isn't just "another n8n workflow"

Three things make or break it, and only one of them is the posting:

1. **Levers, not templates.** Every post is a unique combination of 6 settings (format, angle,
   tone, intensity, length, media type) — 20,412 possible combos. The AI never sees a template;
   it sees a different brief every time. Plus a banned-phrase list and the last 20 posts as
   "do not sound like this" examples.
2. **Real tracking.** A short-link service sits between Threads and Shopee. It gives you
   per-post clicks *immediately* and tags every Shopee visit so orders trace back to the
   exact post — and the exact writing style that produced it. Without this you are optimising
   likes, and likes do not pay you.
3. **A bandit that respects small samples.** 5 posts/day = 15 per 3-day cycle. That is far too
   few to judge a full combination, so the system updates stats on individual levers (which
   converge in ~5 cycles) and only trusts full combos once they have enough data.

**Read [`docs/00-START-HERE.md`](docs/00-START-HERE.md) first** — what the system does, what you
must do yourself, realistic timeline, and failure modes. Then the runbook for setup.

---

## What goes where

```
docs/
  00-START-HERE.md           plain-language overview — read this first
  01-architecture.md         the design, the scoring math, the risks (technical)
  02-n8n-workflows.md        node-by-node build spec (for debugging)
  03-setup-runbook.md        empty VPS → first automated post (click-by-click)
  04-technique-library.md    how the technique system works
  05-books.md                what was mined from your 40+ PDFs (Malay + English)
  06-persona-warmup.md       account warm-up layer (wf6_persona)
  07-l4-reply-loop.md        on-post user comment engagement loop
  08-72h-canary.md           72-hour live debug / canary mode for first deployment
  09-wf6-l4-improvements.md  psychology techniques + time-of-day awareness
  10-malaysian-dataset.md    177 Malaysian persona snippets across 9 domains
  11-quick-start.md          one-click setup for new VPS or update existing
  14-agent-autonomous-deploy.md  what an agent can deploy unattended, and what needs a human

db/                          PostgreSQL: schema, seeds, migrations, queries

n8n/
  code/                      JavaScript brains (bandit, scorer, QA, slot planner)
  workflows/                 n8n workflow templates (import these)

services/
  kb/                        Knowledge Base: product upload + PDF upload
  redirector/                click tracker + SubId injection

infra/
  docker-compose.yml         the whole stack, memory-capped for 4GB/2vCPU
  .env.example               copy → .env → fill in your secrets

scripts/
  setup_new_vps.sh           one-click setup for fresh VPS (installs Docker, DB, everything)
  update_existing_vps.sh     one-click update for running VPS (migrations, seeds, restart)
  bootstrap_n8n.sh           n8n owner + Postgres credential + workflow import (+ --activate)
  set_secrets.sh             write Threads token / Shopee keys into the DB settings table
  init_db.sh                 initialize database schema + migrations + seeds
  import_malaysian_datasets.sh import Malaysian snippets from HuggingFace
  refresh_persona_topics.sh  refresh persona topics via Perplexity Sonar
  configure_llm.sh           configure LLM settings from .env
  observe_72h.sh             72-hour canary observer

prompts/                     the LLM prompts (writer, editor, persona_writer, reply_assistant)
```

## The seven loops

| Loop | Workflow | Runs | What it does |
|---|---|---|---|
| L0 intake | KB web UI/API | on demand | product + image/video assets or description → database row |
| L1 generate | wf2_generate | 03:00 daily | pick levers → write → edit → QA → queue 5 posts |
| L2 publish | wf3_publish | every 5 min | publish queued post → wait → CTA reply with tracked link |
| L3 learn | wf4_evaluate | every 3 days | insights + clicks + orders → score → update arms → breed winners |
| L4 reply | wf7_l4_reply | every 4 hours | answer user comments with psychology techniques + persona calibration once `threads_comments` ingestion and `settings.l4_reply.threads_token` are in place |
| L5 persona | wf6_persona | 03:30 daily | no-link persona posts for account warm-up (Thompson-sampled topics) |
| L6 token | wf0_token_refresh | every 25 days | refresh Threads API token before it expires |

## Build order (do not do it all at once)

P0 Threads token → P1 database → P2 redirector + tunnel → P3 intake → P4 generation →
P5 publishing → P6 evaluation → P7 conversions.

**Do not skip P2.** Everything downstream is worthless without click data.

## Shopee Affiliate Open API

The product-intake enrichment and the wf5 conversion-sync are wired to the official
**Shopee Affiliate Open API** (GraphQL, `open-api.affiliate.shopee.com.my/graphql`), not a
third-party scraper. Add your App ID + API Key from the affiliate dashboard's *Open API* section
to `SHOPEE_API_APP_ID` / `SHOPEE_API_SECRET` (or the `settings` rows `shopee_app_id` /
`shopee_app_secret`):

- **Product enrichment** (`lib/shopee.js` → `productOfferV2`) overlays authoritative price +
  commission on the OG-tag scrape. If you provide the optional full `product_url`, enrichment
  uses it to find the item ID while buyer redirects still use `affiliate_url`. Absent keys →
  graceful fallback, product still works.
- **Conversion sync** (`lib/shopee_conversions.js` → `conversionReport`) pulls orders and joins
  them to posts via the affiliate `sub_id` (= `post.uid`, set by the redirector). CLI:
  `node services/kb/bin/shopee.mjs check|sync|query`.

**You do not need to wait for Shopee Open API approval to set up, generate drafts, publish, or
track clicks.** Without approved API keys, product intake falls back to your description/media
and best-effort page metadata, while the conversion-sync service waits safely. Approval is needed
only for authoritative Shopee price/commission enrichment and automatic order attribution. You
can add the keys later and restart with `docker compose up -d`; keep the first week in draft mode
as described in the runbook. Code reads Shopee keys from `SHOPEE_API_APP_ID` /
`SHOPEE_API_SECRET` first, then `settings` rows `shopee_app_id` / `shopee_app_secret`.

### Optional Apify product-content fallback

When the official Affiliate API is unavailable or its product lookup fails, product intake can
optionally call `chartedsea/shopee-api-scraper` before the normal OpenGraph and user-input
fallbacks. Set `APIFY_TOKEN` (or settings key `apify_token`) to enable it. It is used only for
product content such as title, price, description, categories, variants and a small de-identified
review sample — never for affiliate commissions or conversions.

The KB reserves each Apify run atomically in Postgres before calling an actor. Each active API key
has a hard cap of **25 runs per calendar month**; `APIFY_MONTHLY_MAX_RUNS` may only lower it.
Keys rotate in priority order, so a quota/rate-limited key is disabled until the next month and the
next active key is used. This deliberately conservative per-key cap keeps the optional integration
below the actor's advertised entry pricing. Missing credentials, missing migration, exhausted key
budgets, timeout, or actor errors all fall through to OpenGraph/user input without blocking product
creation. Manage multiple write-only keys and check safe status in Product Research or at
`GET /api/apify/status`.

## Resource budget (4GB / 2 vCPU)

n8n 1.4GB · Postgres 512MB · kb 640MB · redirector 128MB · cloudflared 96MB ·
media assets → Cloudflare R2 (zero local RAM)
≈ 2.8GB ceiling. No local LLM — AI calls go to a configurable OpenAI-compatible endpoint.
Hosted 9router (`https://9router.archxry.space/v1`) is the default; a VPS-host 9router uses
`http://host.docker.internal:9000/v1` from Docker; direct providers like OpenAI also work.

## Honest expectations

- Cycles 1–4 tell you almost nothing. The sample size is too small. Do not touch anything.
- Cycles 5–8 the tone/format signal stabilises.
- Money signal needs ~20 orders before it dominates scoring.
- The banned-phrase list is a living document. Read your own posts weekly or the model
  will quietly collapse back into slop.
