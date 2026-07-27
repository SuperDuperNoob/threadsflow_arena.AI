# START HERE — what you do, what the machine does, what to expect

Read this one file before anything else. It answers four questions:
what state the system is in, what you must do by hand, how long until money,
and what will break.

---

## 1. Honest status: what is and isn't ready

| Component | State | Tested how |
|---|---|---|
| Database schema (28 tables/views) | **Ready** | Applied to a real PostgreSQL 16; all views queryable |
| Cold-start technique library (42) | **Ready** | Every row passes the same validator as PDF-mined ones |
| Knowledge Base service (PDF → techniques) | **Ready** | End-to-end: upload → dedup → mine → validate → merge → live |
| Product intake (URL + images) | **Ready** | Runs inside the KB service; graceful when enrichment fails |
| Redirector (click tracking + SubId) | **Ready** | Boots, redirects, logs, filters Meta's crawler |
| `wf3_publish` | **Ready to import** | All SQL parses; node graph complete |
| `wf0_token_refresh` | **Ready to import** | Complete |
| `wf2_generate` | **Skeleton — you paste 4 code blocks** | Graph + SQL complete; Code nodes are stubs |
| `wf4_evaluate` | **Skeleton — you paste 3 code blocks** | Graph + SQL complete; Code nodes are stubs |
| `wf5_conversions` (Shopee orders) | **Not built** | Optional; system runs on click data until you add it |

**Why the two skeletons.** n8n Code nodes hold JavaScript as a string inside JSON. Embedding
600 lines of bandit and scoring logic as escaped JSON would be unreadable and unmaintainable.
The logic lives in `n8n/code/*.js` as real, reviewable files. You open each stub node and paste
the matching file. That's roughly 15 minutes of copy-paste, once.

**What I could not test:** anything touching the real Threads API or real Shopee (no
credentials), and the real LLM path (tested against a stub that mimics the response shape).
Everything else ran against a live PostgreSQL and a live HTTP server in this workspace.

---

## 2. Resource budget — it fits, with room to spare

Measured, not estimated:

| Service | Cap | Notes |
|---|---|---|
| n8n | 1400 MB | the only real consumer |
| postgres | 512 MB | tuned: `shared_buffers=192MB` |
| kb | 640 MB | **measured peak 88 MB** parsing a 400-page PDF in 0.4 s |
| minio | 320 MB | skip entirely if you use Cloudflare R2 |
| redirector | 128 MB | ~40 MB actual |
| cloudflared | 96 MB | |
| **Total caps** | **3096 MB** | of 4096 MB — **1 GB headroom** |

Three rules keep it there:
1. **No local LLM.** Inference goes out through 9router. ~$0.30/month at 5 posts/day.
2. **PDF mining is serial** — one book at a time. Two concurrent 300-page books would OOM.
3. **n8n execution data is pruned** to 7 days, success payloads discarded.

**If you want it smaller:** drop MinIO and use Cloudflare R2 (free tier, no egress fee).
That's −320 MB and one less thing to back up. Set `IMAGE_BACKEND=s3` and point
`S3_ENDPOINT` at R2 — the S3 client is built in, no SDK.

**Free outsourcing available:** Threads API (free), Cloudflare Tunnel + R2 (free tier),
OG-tag enrichment (free, no Apify needed). Apify is optional and only for Shopee conversions.

---

## 3. The system works with ZERO PDFs

This matters, so it's explicit: `db/seed_techniques.sql` ships **42 hand-written techniques**
covering hooks, proof, voice, psychology, structure, CTA and anti-patterns — plus 19 banned
phrases, 34 lever values and 15 CTA variants.

You can post for months without ever opening the Knowledge Base. Uploading PDFs only:
- adds techniques the seed set lacks,
- raises `corroboration` where a book agrees with the seed (a stronger prior),
- adds regex anti-patterns straight into the QA gate.

The Knowledge Base is an amplifier, never a dependency.

---

## 3b. Three ways to add a product — images are optional

| You have | Accepted | What happens |
|---|---|---|
| link + images | ✅ | Single-image and carousel posts. ~15% of posts still go text-only as exploration. |
| link + images + description | ✅ | Richest input. Description feeds facts the photo can't show (price, warranty, size). |
| **link + description** | ✅ | **Text-only posts.** No image needed anywhere in the pipeline. |
| link alone | ❌ | Rejected. With no photo and no words there is nothing concrete to write from, and invented copy is exactly the slop this project exists to avoid. |

**Text-only is a first-class mode, not a fallback.** Threads is a text-first feed and text posts
often out-reach image posts there. `media_type` is a real bandit lever (TEXT / IMAGE / CAROUSEL)
scored alongside tone and format, so within ~6 cycles `SELECT * FROM v_media_performance` tells
you which actually earns on *your* account.

Three rules make it safe:
- **No images → description must be ≥ 80 characters.** Without a photo the words carry
  everything, so the QA gate also demands at least one concrete detail (a number, material or
  measurement) even at `sell_intensity=0`.
- **The bandit can never pick an impossible media type.** 0 images → TEXT only. 1 image → TEXT
  or IMAGE. 2+ → all three. A DB CHECK constraint enforces the same invariant, so a malformed
  post can't reach the Threads API and fail opaquely 30 seconds later.
- **If a CDN image goes missing at publish time**, wf3 downgrades to TEXT rather than losing the
  slot. A text post is a fine post; a failed API call is a wasted slot.

The QA gate also blocks the two characteristic failures: a text post referring to a photo that
doesn't exist, and an image post narrating the photo the reader can already see.

---

## 4. What YOU must do by hand

### Before anything (blocking, ~2 hours, mostly waiting on Meta)

1. **Get a Threads token.** developers.facebook.com → Create App → "Access the Threads API".
   Add permissions `threads_basic`, `threads_content_publish`, `threads_manage_insights`,
   `threads_manage_replies`. Then **App roles → Threads Tester → add your own username**, and
   accept the invite at threads.net → Settings → Website permissions.
   *This step replaces Meta App Review entirely because you post to your own account.*
   Exchange for a long-lived token and **verify with the curl smoke test in
   `docs/03-setup-runbook.md` §1 before building anything else.**

2. **Point 4 Cloudflare Tunnel hostnames** (Zero Trust → Public Hostnames):

   | Hostname | Service | Access policy |
   |---|---|---|
   | `n8n.you.com` | `http://n8n:5678` | **your email only** |
   | `kb.you.com` | `http://kb:8082` | **your email only** |
   | `r.you.com` | `http://redirector:8081` | **NONE — buyers must reach it** |
   | `cdn.you.com` | `http://kb:8082` | **NONE — Meta must fetch images** |

   Getting the last two wrong is the #1 cause of "it silently doesn't work".

3. **Bring up the stack** (`docs/03-setup-runbook.md` §2) and apply the schema in this order:
   ```
   schema.sql → schema_techniques.sql → schema_kb.sql
   → seed_levers.sql → seed_techniques.sql → mining_questions.sql
   ```
   Already running an older install? Apply `db/migrations/001_optional_media.sql` — it is
   idempotent and backfills `media_mode` from what each product actually has.

4. **Insert your secrets** into the `settings` table (token, user_id, LLM base URL/key).

5. **Import 4 workflows**, create the `Postgres threadsflow` credential, and **paste the 7 code
   blocks** into the stub nodes:
   - `wf2_generate`: slot_plan.js, bandit.js (select), technique_picker.js (select), qa.js
   - `wf4_evaluate`: scoring.js, bandit.js (update+plan), technique_picker.js (update)

### The one thing that decides whether this makes money

**Week 1: run generation in draft mode and read all 35 posts yourself.**

Set `wf2_generate` to insert `status='draft'` instead of `'queued'`. Then:

```sql
SELECT format, tone, body FROM posts WHERE status='draft' ORDER BY created_at;
```

You will find 5–10 phrases that sound like a machine. Add each one:

```sql
INSERT INTO banned_phrases (pattern, reason, scope) VALUES ('your regex', 'why', 'all');
```

This hour of reading is worth more than every prompt in this repo. Nobody else can do it —
only you know what sounds wrong in your voice, to your audience.

### Ongoing (15 min/week)

| When | What |
|---|---|
| Weekly | Read 5 random posts. Add robotic phrases to `banned_phrases`. |
| Weekly | Add 1–2 products. Images optional — a link + good description is enough. |
| Weekly | `SELECT * FROM run_log WHERE level='error' AND ts > now()-interval '7 days'` |
| Every 3 days | Read the cycle digest — **but don't act before cycle 5** |
| Monthly | Retire CTA variants with `use_count > 8`; add 5 new ones |
| Every 25 days | Confirm wf0 refreshed the token |

---

## 5. Timeline — what to expect, honestly

| When | What happens | What you should NOT do |
|---|---|---|
| **Day 0–1** | Setup. First manual post via curl works. | — |
| **Day 2–7** | Draft mode. You read 35 posts, build the banned list. | Don't go live before this. |
| **Week 2** | Live posting, 5/day. First clicks appear in `clicks`. | Don't judge anything yet. |
| **Cycle 1–4 (day 1–12)** | 15 posts/cycle. Scores are almost pure noise. | **Don't change settings.** n is too small. This is the hardest instruction to follow. |
| **Cycle 5–8 (day 12–24)** | Tone and format signal stabilizes. Digest becomes readable. | Don't add more than 1–2 changes per cycle. |
| **Week 4–6** | First Shopee conversions. `w_money` starts climbing from 0. | Don't expect meaningful revenue yet. |
| **~20 lifetime orders** | Scoring becomes fully money-driven rather than engagement-driven. | — |
| **Month 3+** | The bandit has real evidence. This is when compounding starts. | — |

**Realistic revenue expectation.** With 5 posts/day on a new account: expect a few hundred to a
few thousand views per post initially, sub-1% CTR, and Shopee commissions of 2–10% on low-ticket
items. The first month will likely earn less than the VPS costs. The system's value is that it
compounds — it gets better while you sleep — not that it prints money in week one.

**The single biggest variable is not the software. It's your product selection and your notes
field.** A great system posting about a product nobody wants earns zero. Spend your time picking
products with real demand and writing concrete notes about them.

---

## 6. Making it not break

Failure modes are ranked by how likely they are to actually hit you.

### Already handled in code
- **Meta's crawler inflating clicks** → UA filter + 60s IP dedup in the redirector. Without this
  your bandit optimizes for bot traffic.
- **Double-posting on overlapping cron runs** → optimistic row lock (`status='publishing'`).
- **Quota exhaustion** → checks `threads_publishing_limit` before every publish, aborts over 200.
- **Enrichment/vision failure** → product still created, posting still works.
- **KB service down during generation** → HTTP node continues; generation proceeds with levers only.
- **Worker crash mid-PDF** → stale jobs reclaimed after 45 min, 3 attempts, then marked failed.
- **A PDF yielding nothing** → explicit warning instead of silent "done, 0 techniques".
- **Merge corrupting a technique** → type-equality gate (this was a real bug found in testing).
- **Short PDFs vanishing** → whole-document fallback chunk (also a real bug found in testing).
- **Over-broad regex from the LLM** → validator rejects `.*`-style patterns that would nuke every post.

### You must handle
1. **Token expiry.** wf0 runs every 25 days. **Add a Telegram or email node to its failure
   branch.** A dead token is silent for 3 days before you notice, and that's 15 lost posts.
2. **Account throttling.** If views collapse across all posts for 3+ days, you're flagged.
   Drop to 2 posts/day for a week and raise the `sell_intensity=0` share to 40%.
3. **Model drift.** Your banned list is a living document. Re-read posts every 2 weeks or the
   LLM slowly finds new ways to sound generic.
4. **Backups.** `docker compose exec postgres pg_dump -U threadsflow threadsflow | gzip > bk.gz`
   weekly. The bandit's learned state is the asset here, not the code.

### The three mistakes that kill this
1. **Acting on cycle 1–4 data.** 15 posts is not a sample. You will see a "winner" that is noise,
   over-invest in it, and destroy the exploration the system needs. Wait for cycle 5.
2. **Skipping the redirector.** Without click data you're optimizing likes. Likes don't pay.
3. **Skipping draft week.** Going straight to live posting means 35 mediocre posts train the
   bandit on your worst output, and the account starts with weak signals.

---

## 7. Where to go next

- `docs/01-architecture.md` — the flow, levers, scoring math, risks
- `docs/02-n8n-workflows.md` — node-by-node build spec
- `docs/03-setup-runbook.md` — VPS → first post, plus a troubleshooting table
- `docs/04-technique-library.md` — why not to call NotebookLM live, and what to do instead
- `db/queries.sql` — the 15 analysis queries you'll actually use
