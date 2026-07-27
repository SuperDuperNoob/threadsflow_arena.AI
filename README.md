# ThreadsFlow

Self-optimizing Shopee-affiliate posting machine for Threads.

**You do:** paste an affiliate URL, plus images *or* a description (or both) into a form.
**It does:** writes non-templated copy, posts 5×/day at jittered times, drops the tracked
affiliate link in the first comment, measures views → clicks → orders, and every 3 days
re-invests posting slots into the styles that actually earned money. Forever, until you stop it.

---

## Why this isn't just "n8n that posts"

Three things make or break it, and only one of them is the posting:

1. **Levers, not templates.** Every post is a point in a 6,804-combination space
   (12 formats × 9 angles × 7 tones × 3 sell intensities × 3 lengths). The LLM never sees a
   template — it sees a different behavioural brief every time, plus a hard list of banned
   phrases and the last 20 posts to avoid.
2. **Real tracking.** A 100-line redirector service sits between Threads and Shopee. It gives
   you per-post clicks immediately and passes `sub_id=<post_uid>` to Shopee so orders join back
   to the exact post → the exact lever combination. Without this you're optimizing likes, and
   likes don't pay.
3. **A bandit that respects small samples.** 5 posts/day = 15 per cycle. That's far too few to
   judge a full combination, so the learner updates **marginal lever stats** (which converge in
   ~5 cycles) and only trusts a full combo at n ≥ 4. Money weight ramps in via shrinkage as
   orders accumulate, so early cycles optimize attention and later cycles optimize rupiah.

**Read [`docs/00-START-HERE.md`](docs/00-START-HERE.md) first** — status, what you must do by
hand, realistic timeline, and failure modes. Then `docs/01-architecture.md` for the design.

---

## Repo layout

```
docs/01-architecture.md     the flow, the levers, the scoring math, the risks
docs/02-n8n-workflows.md    node-by-node build spec for all 5 workflows
docs/03-setup-runbook.md    empty VPS → first automated post, plus troubleshooting
docs/04-technique-library.md  why NOT to call NotebookLM live, and what to do instead
db/schema.sql               PostgreSQL schema
db/seed_levers.sql          12 formats, 9 angles, 7 tones, banned phrases, CTA pool, settings
db/seed_techniques.sql      42 cold-start techniques — the system runs with ZERO PDFs uploaded
db/migrations/              001_optional_media.sql — makes images optional on existing installs
db/queries.sql              the analysis queries you'll actually use
db/schema_techniques.sql    Technique Library: mined copywriting techniques as testable arms
db/mining_questions.sql     30 questions to extract technique from your NotebookLM PDFs
scripts/mine_techniques.mjs one-time miner: NotebookLM answers -> structured techniques
n8n/code/bandit.js          Thompson sampling, arm updates, next-cycle breeding plan
n8n/code/scoring.js         z-scored EPM/CTR/ENG blend with money shrinkage
n8n/code/qa.js              the anti-AI-slop gate (regex bans + embedding + 3-gram overlap)
n8n/code/slot_plan.js       jittered daily slots, skip probability, forced non-commercial post
n8n/code/technique_picker.js  picks 1-2 compatible devices per post + 15% control group
n8n/workflows/              wf0 + wf3 ready to import; wf2 + wf4 need 7 code blocks pasted
services/kb/                Knowledge Base: PDF upload -> techniques, plus product intake UI
prompts/writer.md           LLM call 1 — the brief
prompts/editor.md           LLM call 2 — strips AI shape (this one does the heavy lifting)
prompts/cta.md              LLM call 3 — the link comment
prompts/technique_extractor.md  turns book prose into executable, testable constraints
services/redirector/        click tracking + SubId injection
infra/docker-compose.yml    the whole stack, memory-capped for 4GB/2vCPU
```

## The four loops

| Loop | Period | Job |
|---|---|---|
| L0 intake | on demand | product + images → enriched DB row with 5 concrete facts |
| L1 generate | 03:00 daily | bandit picks levers → write → edit → QA → queue 5 posts |
| L2 publish | */5 min | container → publish → wait → CTA reply with tracked link |
| L3 learn | every 3 days | insights + clicks + orders → score → update arms → breed winners |

## Build order (don't do it all at once)

`P0` Threads token + one manual curl post → `P1` DB up → `P2` redirector + tunnel →
`P3` intake → `P4` generation → `P5` publishing → `P6` evaluation → `P7` conversions.

**Do not skip P2.** Everything downstream is worthless without click data.

## Resource budget (4GB / 2 vCPU)

n8n 1.4GB cap · Postgres 512MB · MinIO 320MB · UI 256MB · redirector 128MB · cloudflared 96MB
≈ 2.7GB ceiling. No local LLM — inference goes out through 9router to hosted models
(~$0.30/month at 5 posts/day × 3 calls).

## Honest expectations

- Cycles 1–4 tell you almost nothing. n is too small. Don't touch anything.
- Cycles 5–8 the tone/format signal stabilizes.
- Money signal needs ~20 orders before it dominates scoring.
- The banned-phrase list is a living document. Read your own posts weekly or the model will
  quietly collapse back into slop.
