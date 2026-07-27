# ThreadsFlow

**Self-improving Shopee-affiliate posting system for Threads. Malaysian Malay, RM, KL time.**

**What you do:** paste a Shopee affiliate link, plus photos *or* a written description.
**What it does:** writes posts in everyday Malay (a different style every time), posts 5×/day,
puts the tracked link in the first comment, counts clicks and sales, and every 3 days shifts
more posting slots to whatever actually made money. Runs until you stop it.

**New?** Start with **[`docs/00-START-HERE.md`](docs/00-START-HERE.md)** — plain language,
no jargon. Then **[`docs/03-setup-runbook.md`](docs/03-setup-runbook.md)** — click-by-click
setup that assumes you know nothing about Docker, Cloudflare, or the Threads API.

---

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
  05-books.md                what was mined from your 26 PDFs

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

prompts/                     the three LLM prompts (writer, editor, CTA)
```

## The four loops

| Loop | Runs | What it does |
|---|---|---|
| L0 intake | on demand | product + images → database row |
| L1 generate | 03:00 daily | pick levers → write → edit → QA → queue 5 posts |
| L2 publish | every 5 min | publish queued post → wait → CTA reply with tracked link |
| L3 learn | every 3 days | insights + clicks + orders → score → update arms → breed winners |

## Build order (do not do it all at once)

P0 Threads token → P1 database → P2 redirector + tunnel → P3 intake → P4 generation →
P5 publishing → P6 evaluation → P7 conversions.

**Do not skip P2.** Everything downstream is worthless without click data.

## Resource budget (4GB / 2 vCPU)

n8n 1.4GB · Postgres 512MB · kb 640MB · redirector 128MB · cloudflared 96MB ·
images → Cloudflare R2 (zero local RAM)
≈ 2.8GB ceiling. No local LLM — AI calls go to hosted models via 9router
(~$0.30/month at 5 posts/day).

## Honest expectations

- Cycles 1–4 tell you almost nothing. The sample size is too small. Do not touch anything.
- Cycles 5–8 the tone/format signal stabilises.
- Money signal needs ~20 orders before it dominates scoring.
- The banned-phrase list is a living document. Read your own posts weekly or the model
  will quietly collapse back into slop.
