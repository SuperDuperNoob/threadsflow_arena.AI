# ThreadsFlow — Architecture & Flow

> **This is the technical deep-dive.** If you are setting up the system for the
> first time, read `docs/00-START-HERE.md` and `docs/03-setup-runbook.md` instead.

Goal: you drop **1 affiliate URL, optionally the full product URL for enrichment, plus media and/or a description** into a small web form or API.
The browser form currently accepts JPG/PNG images; the backend intake API accepts JPG/PNG/WebP images and MP4/MOV videos.
The system then writes non-templated copy, posts to Threads on schedule, drops the affiliate link in the first comment for product posts,
measures what worked, and every 3 days re-invests posting slots into the winning styles — per product and globally.

**Implementation caveat:** migration 020 added `VIDEO` and `MIXED_CAROUSEL` to the data model and bandit levers, but the shipped `n8n/workflows/wf3_publish.json` still routes only `TEXT`, `IMAGE`, and image-only `CAROUSEL`. Treat video/mixed publishing as schema/intake groundwork, not a safe live publisher, until `wf3_publish` gets video container creation and status polling.

---

## 0. The mental model (read this first)

This is **not** "an n8n workflow that posts". It is a small **multi-armed bandit content machine**
with multiple cooperating loops.

> **Multi-armed bandit:** imagine a row of slot machines. You have limited coins.
> You do not know which machine pays best. So you try them all at first, and as
> you see which ones pay, you shift more coins to the winners while still
> occasionally trying the others to see if they got better. The system does this
> with writing styles instead of slot machines.

| Loop | Period | What it does |
|---|---|---|
| **L0 Intake** | on demand | You submit product + media/description → normalized into `products`; media assets are uploaded to public storage and recorded in `product_images` |
| **L1 Generate** | nightly 03:00 | Builds post slots: picks product × angle × hook-family × tone via bandit, writes copy with LLM, QA-checks it, sends it to review |
| **L2 Publish** | every 5 min scan | Publishes approved/auto-published due posts, then posts CTA + tracked affiliate link as **self-reply** for product posts with `sell_intensity != 0` |
| **L3 Learn** | every 3 days 02:00 | Pulls insights + clicks + Shopee conversions, scores each post, updates bandit weights, kills losing arms, breeds variations of winners |
| **L4 Reply** | every 4 hours | Replies to comments on your posts when enabled by `settings.l4_reply` |
| **L5 Persona** | nightly 03:30 | Queues no-link persona warm-up posts from `persona_topics` |
| **L6 Token** | every 25 days | Refreshes the long-lived Threads token in `settings.threads_creds` |

Loop L3 is what makes it "not a poster". Everything the LLM produces is tagged with the
**exact combination of levers** that produced it, so the scoring loop knows *what* worked, not
just *which post* worked.

---

## 1. Component map (fits 4GB / 2 vCPU comfortably)

```
                       Cloudflare Tunnel (no open ports)
                                   │
        ┌──────────────────────────┼───────────────────────────┐
        │                          │                           │
   kb.yourdomain             n8n.yourdomain              r.yourdomain
   (KB web UI/API)           (n8n editor, protected)     (link redirector)
        │                          │                           │
   ┌────▼──────┐            ┌──────▼──────┐             ┌──────▼──────┐
   │    kb     │            │    n8n      │             │ redirector  │
   │ Node app  │            │ workflow    │             │ tiny Node   │
   │ ~640MB    │            │ engine      │             │ ~128MB      │
   └────┬──────┘            └──────┬──────┘             └──────┬──────┘
        │                          │                           │
        └───────────┬──────────────┴─────────────┬─────────────┘
                    │                            │
             ┌──────▼──────┐              ┌──────▼──────┐
             │ PostgreSQL  │              │ Cloudflare  │
             │ app + n8n   │              │  R2 bucket  │  ← media URLs must be public HTTPS
             └─────────────┘              └─────────────┘
                    │
             ┌──────▼─────────────────────────────┐
             │ OpenAI-compatible LLM endpoint       │  ← default hosted 9router or your provider
             └────────────────────────────────────┘

  shopee-sync is a separate container using the kb image; it pulls Shopee conversions every 12h when keys exist.
```

**RAM budget** from `infra/docker-compose.yml`: n8n 1.4GB, Postgres 512MB, kb 640MB,
redirector 128MB, shopee-sync 160MB, cloudflared 96MB. **Do not run a local LLM.**
Use the configurable OpenAI-compatible endpoint (9router by default, direct provider if preferred)
to hit hosted models; a post costs fractions of a cent.

> **Media hosting note:** Threads fetches `image_url` / `video_url` server-side, so media must be on a
> publicly reachable HTTPS URL. The system uses Cloudflare R2 with a public bucket
> (free tier, 10 GB storage, zero egress cost — Meta's fetches cost you nothing).
> Do **not** serve production assets from a private VPS path; Meta needs to fetch them.

---

## 2. The six levers (why the copy never looks templated)

Every post is a point in a 6-dimensional space. The bandit optimizes over the *combination*,
and the LLM is forbidden from ever seeing a "template".

> **Lever:** a setting with multiple options that changes how the post reads.
> Think of it like the dials on a sound mixer — format is the "instrument" knob,
> tone is the "brightness" knob, length is the "volume" slider. The system turns
> all dials to different positions for every post.

| Lever | Examples | Count |
|---|---|---|
| **format** | flash_story, confession, POV, text-message screenshot narration, list-of-3, single-line hook + silence, "review jujur", unboxing diary, "chat sama temen", myth-bust | 12 |
| **angle** | problem-agitate, before/after, price-shock, social proof, scarcity, curiosity gap, identity ("orang yang X pasti ngerti"), utility/tips-first, contrarian | 9 |
| **tone** | deadpan, hyper-casual gaul, warm older-sibling, dry corporate-parody, chaotic gen-z, calm minimalist, over-enthusiastic | 7 |
| **sell_intensity** | 0 = pure story/value (link still in comment), 1 = soft, 2 = direct | 3 |
| **length_band** | micro (<120 chars), mid (120–260), long (260–480) | 3 |
| **media_type** | `TEXT`, `IMAGE`, `CAROUSEL`, `VIDEO`, `MIXED_CAROUSEL` — constrained by what the product actually has; current publisher is safe only for `TEXT`/`IMAGE`/image-only `CAROUSEL` | 5 |

On top of the levers, each post also carries **1–2 "devices"** drawn from the technique
library (built-in Malay, book-mined, 2026 Threads, and psychology rows). Devices are
Thompson-sampled and scored exactly like levers, and 15% of posts deliberately get none so you
can tell whether the library is helping at all. See `docs/04-technique-library.md` and
`docs/05-books.md`.

Combinatorial space with the five media values = 12×9×7×3×3×5 = **34,020 arms**. You post ~150/month, so you will never repeat
a combination in practice. Plus each generation carries an **anti-repetition context**: the last
20 posts' first 8 words + their embeddings; the QA node rejects anything with cosine similarity
> 0.86 against the last 30 posts and regenerates.

> **Cosine similarity:** a number from 0 to 1 that measures how similar two pieces
> of text are. 0 = completely different. 1 = identical. The QA node rejects anything
> above 0.86, meaning it will not let the system post something that sounds too
> much like a previous post.

**Hard bans** enforced by the QA node (this is what kills "AI template smell"):

```
- no "Korang pernah tak..." / "Siapa kat sini yang..." openers (banned opener list)
- no em-dash chains, no "bukan sahaja X, tetapi juga Y" parallelism
- no emoji rows, max 2 emoji total, 0 emoji for tone=deadpan/minimal
- no "cepat sebelum", "jangan lepaskan peluang", "stok terhad" unless sell_intensity=2
- no hashtag stacks (max 1, and only 40% of the time)
- must not start with the product name
- must not exceed 500 chars (Threads hard limit)
- **no Indonesian.** banget/nggak/gak/aja/udah/bikin/gimana/kalian are banned outright, and
  `bisa` (venom in Malay) and `butuh` (vulgar) are hard errors, not style preferences
- **no shouting.** 3+ ALL-CAPS words, or >25% of the post in caps, is rejected. RM/OK/USB/LED
  are exempt.
- **no 2015-era hard sell.** PERCUMA / RAHSIA TERBONGKAR / EKSKLUSIF / "PM saya sekarang"
- text-only posts additionally require one concrete detail and must not reference a photo
- must pass a "would a human write this?" self-critique pass (second LLM call, cheap model)
```

---

## 3. Data flow, step by step

### L0 — Intake (you, in the browser, 60 seconds)

```
POST /api/products   (multipart, served by the KB service)
{
  affiliate_url: "https://s.shopee.com.my/xxxx",  // required buyer/money link
  product_url:   "https://shopee.com.my/product/...", // optional, enrichment only
  images:        [file, ...],                     // multipart field name; backend accepts 0-20 JPG/PNG/WebP/MP4/MOV
  description:   "...",                           // required only when no media files are supplied (>=80 chars)
  name:          "optional, LLM fills if blank",
  price_myr:     "optional",
  notes:         "optional: 'untuk mak-mak, harga RM39, free shipping'"
}
```

**Three valid shapes.** `affiliate link + media`, `affiliate link + media + description`,
`affiliate link + description`. The optional `product_url` may be added to any of them. Only
`affiliate link` alone is rejected: with neither media nor words there is nothing concrete to
write from, and the LLM would invent details — the exact failure this project exists to prevent.

`products.affiliate_url` is always the buyer redirect target. `products.product_url` is optional
and used only for enrichment/Open API item lookup. `products.media_mode` is currently set to
`images` whenever any media file exists and `text` otherwise; the individual file type is stored
on `product_images.media_kind` as `IMAGE` or `VIDEO`.

The KB service does:
1. Upload any accepted media files → Cloudflare R2 (or local) → public URLs → `product_images`.
   **Skipped entirely when none were supplied.**
2. **Enrich**: if `product_url` exists, use that plain Shopee product page first; otherwise use
   the affiliate URL. The optional product URL helps the Shopee Open API parse the visible item id
   while preserving `affiliate_url` as the commission-bearing buyer link. The service fetches OG
   tags when available and folds in your description + notes → `products.enrichment` JSONB. Emits
   `concrete_details` (checkable facts) and `detail_confidence`. *This is the single biggest
   quality lever.* Shopee blocks datacenter IPs often, so this is best-effort — it falls back to
   splitting your own description into facts, and the product stays fully postable either way.
   **When Shopee Open API keys are configured** (`SHOPEE_API_APP_ID`/`SHOPEE_API_SECRET`), the
   `productOfferV2` query overlays *authoritative* `price_min`, `commission_rate`, `sales` and
   `rating` onto the enrichment (see `lib/shopee.js` → `enrichProductFromShopee`). The OG scrape
   remains the fallback, so absence of keys never degrades the product.
3. **Vision pass:** intended for images → a cheap vision model → `product_images.vision_desc`
   ("close-up of the matte black handle, wooden table, warm light"), so copy **matches the image
   it's paired with**. The helper can skip `media_kind='VIDEO'`, but the current server query does
   not pass `media_kind` into `describeImage()`, so video vision handling is not yet cleanly wired.
   **Text-only path instead**: enrichment emits `sensory_details` — physical facts drawn strictly
   from your description that stand in for the missing photo. If the description doesn't support
   them it returns an empty array and sets `detail_confidence='low'`, and the writer is told to
   work with less rather than invent.
4. `INSERT` product with `status='active'` and `media_mode`. Arms are created lazily on first
   pull, never pre-materialized.

Enrichment and vision run **after** the DB commit and are allowed to fail. The product exists and
is postable the moment you hit submit; no external service can block you.

### L1 — Nightly generation (03:00, 1 run, produces 5 queued posts)

```
Cron 03:00
 └─ pick 5 slots for today  (slot times = jittered: 07:1x, 11:3x, 15:0x, 19:2x, 21:4x ±18min)
     └─ for each slot:
         1. SELECT product  → weighted by product_score (Thompson sampling, see §4)
         2. SELECT arm      → epsilon-greedy 0.25 explore / 0.75 exploit over lever combos.
                              media_type is gated by what the product HAS:
                                0 media files      → TEXT only
                                images only        → TEXT | IMAGE | CAROUSEL (carousel needs 2+ images)
                                exactly 1 video    → TEXT | VIDEO
                                image+video mix    → TEXT | IMAGE | VIDEO | CAROUSEL | MIXED_CAROUSEL
                              Products with media still draw TEXT sometimes, so you
                              learn whether the visual was even helping.
         3. SELECT media    → fewest impressions first, round-robin. Skipped for TEXT; media_kind filters image vs video choices.
         4. BUILD prompt    → system + product facts + lever instructions
                              + vision_desc (image posts) OR the no-image block (text posts)
                              + last-20-posts anti-repeat list + banned phrase list
         5. LLM call #1     → draft (temp 1.0)
         6. LLM call #2     → critique+rewrite
         7. QA node         → regex bans + length + embedding similarity. Fail → retry ≤3, then
                              fall back to a different arm.
         8. Generate CTA comment text (separate style pool, 30 variants, also randomized)
         9. Build tracked link: base affiliate URL + sub_id = post_uid  (see §5)
        10. INSERT into `posts` (status='pending_review', scheduled_at, review_timeout_at, all lever values, prompt_hash)
        11. INSERT into `post_review` (pending_review state initialized automatically via trigger/node)
```

**Human-in-the-Loop Review Gate:** Every generated post enters a `pending_review` state rather than publishing immediately. You can review, approve, reject, or edit drafts via the secure web dashboard at `https://kb.yourdomain.com/queue.html`. If you don't act before the timeout window (`review_timeout_at`, default 2 hours before schedule), an automated timeout sweep promotes the post to `auto_published` using the bandit's pre-generated best arm variant. Active reviews are protected by a sliding `review_locked_until` lock so posts open in the dashboard are never published out from under you. Human decisions (approval/edit = `+1.0`, rejection = `-1.0`) feed into the scoring pipeline (`w_human = 0.15`) alongside Shopee commissions and engagement.

Cost: 5 posts × 3 calls × ~1.5k tokens ≈ nothing (< $0.01/day on a cheap model).

### L2 — Publish (scans the queue every 5 minutes)

```
1. GET /{threads-user-id}/threads_publishing_limit   → abort if quota_usage > 200
2. `Quota guard` resolves the final media type from `posts.media_type` and resolved `image_urls`:
     - no resolved URL for non-text media → downgrade to `TEXT`
     - `CAROUSEL` with one URL → downgrade to `IMAGE`
     - `IMAGE` with multiple URLs → truncate to one URL
3. Current `Route by media type` branches in `wf3_publish.json`:
     TEXT     → POST /threads  media_type=TEXT & text=<copy>
     IMAGE    → POST /threads  media_type=IMAGE & image_url=<public url> & text=<copy>
     CAROUSEL → POST /threads  media_type=IMAGE & is_carousel_item=true  (once per image)
                then POST /threads media_type=CAROUSEL & children=<ids> & text=<copy>
4. WAIT 35s for IMAGE/CAROUSEL, 3s for TEXT. There is no status-poll loop in the current workflow.
5. POST /v1.0/{user-id}/threads_publish?creation_id=...   → media_id
6. WAIT 45–120s (random) — looks human, and lets the post get initial distribution
7. Create reply container: media_type=TEXT, text=<cta + tracked link>, reply_to_id=<media_id>
8. Publish reply → reply_id
9. UPDATE posts SET status='published', threads_media_id, threads_reply_id, published_at

**Not yet implemented in `wf3_publish.json`:** `VIDEO` should create a Threads container with
`media_type=VIDEO` and `video_url=<url>`, then poll `GET /v1.0/{container_id}?fields=status,error_message`
until `status == 'FINISHED'` before `threads_publish`. `MIXED_CAROUSEL` should create child
items with `media_type=IMAGE` or `media_type=VIDEO` plus `is_carousel_item=true`, wait/poll video
children, then group children under a parent `CAROUSEL` container. Those nodes are absent today.
```

**Why link in the comment:** Threads suppresses reach on posts with outbound links in the body.
Link in the first self-reply keeps the parent clean.

### L3 — Evaluation every 3 days (02:00)

```
Cron */3 days
 1. Pull insights for posts from last 3 days (and day-7 long-tail re-read)
 2. Pull clicks from the redirector DB (grouped by post_uid)
 3. Pull conversions from Shopee (matched on sub_id = post_uid)
 4. Compute score (see §4)
 5. UPDATE arm_stats: n += 1, reward += score, per lever AND per full combo
 6. Decide next 3 days: breed winners, cooldown losers, rest dead products
 7. Write a human-readable digest into cycle_reports
```

---

## 4. Settings table and live configuration

`settings` is a generic `key TEXT PRIMARY KEY, value JSONB` table. Current code reads these keys:

| Key | Current reader/writer | Reload behavior |
|---|---|---|
| `llm` | `services/kb/lib/llm.js`, `wf2_generate`, `wf6_persona`; edited by `/settings.html` (LLM tab) via `GET/PUT /api/config/llm` and `scripts/configure_llm.sh` | KB caches for ~5 seconds; n8n reads at workflow execution time. |
| `qa` | `wf2_generate`, `wf6_persona`, `n8n/code/qa.js`, `n8n/code/qa_persona.js` | Read at workflow execution time. |
| `posting` | `wf2_generate`, `wf4_evaluate`, seed defaults | Read at workflow execution time. |
| `bandit` | `wf2_generate`, `wf4_evaluate`, `wf6_persona` | Read at workflow execution time. |
| `scoring` | `wf4_evaluate`, `n8n/code/scoring.js` | Read at workflow execution time. |
| `warmup` | `wf6_persona` | Read at workflow execution time. |
| `l4_reply` | `wf7_l4_reply` | Read at workflow execution time. Current workflow also expects `l4_reply.value.threads_token` for reply publishing. |
| `next_cycle_plan` | `wf2_generate` reads it; `wf4_evaluate` writes it | Updated every evaluation cycle. |
| `threads_creds` | `wf0_token_refresh`, `wf3_publish`, `wf4_evaluate`; written by `scripts/set_secrets.sh` | Read at workflow execution time. |
| `text_variation` | Seeded by migration 015 and used by `n8n/code/text_variation.js` only if a workflow node is added | Not wired into current workflow JSONs. |
| `locale`, `redirect_base_url`, `shopee_app_id`, `shopee_app_secret` | Seed/config support keys; Shopee code reads `shopee_app_id` / `shopee_app_secret` after env vars | Mixed; service-level code reads on demand. |

**Now live:** `/settings.html` is a tabbed System Settings Control Board. Besides the LLM tab
(`/api/config/llm`), the Posting Schedule, Bandit / Scoring, Content / QA, Auto-Reply Loop, and
Warmup tabs read/write via the generic `GET /api/config/system/:key` and `PUT /api/config/system/:key`
routes (`services/kb/server.js:275-300`). Both routes 404 on any key outside the allowlist
`{posting, bandit, qa, l4_reply, warmup, scoring}` (`services/kb/server.js:238`), so secret-bearing
keys such as `threads_creds` can never be read or written through this surface. `PUT` does an atomic
read-modify-write merge and runs key-specific range validation (`validateSystemSetting`,
`services/kb/server.js:240-273`) — e.g. `skip_probability`/`epsilon`/`max_similarity` must be 0–1,
`jitter_minutes` ≥ 0 — before the merged JSON is upserted into the `settings` row.

---

## 5. Scoring — the part that decides whether you make money

Do **not** optimize likes. Optimize money, with engagement as an early proxy while conversion
data is sparse.

**The formula in plain language:** each post gets a single score answering
"did it make money?" When there are few sales, likes and reposts carry more
weight. As sales accumulate, actual commissions take over.

```
CTR      = clicks / max(views, 1)
ENG      = (likes + 3*replies + 5*reposts + 4*quotes) / max(views, 1)
CVR      = orders / max(clicks, 1)
EPM      = commission_myr / max(views,1) * 1000      # earnings per 1000 views

Global_CTR = sum(clicks) / max(sum(views), 1)
Global_EPM = sum(commission_myr) / max(sum(views), 1) * 1000
C          = 50 clicks  # Bayesian prior weight

Bayes_CTR = ((clicks * CTR) + (C * Global_CTR)) / (clicks + C)
Bayes_EPM = ((clicks * EPM) + (C * Global_EPM)) / (clicks + C)
score     = smooth lift of Bayes_EPM/Bayes_CTR/Bayes_ENG vs global baseline
```

The old cycle z-score logic was too jumpy at ~15 posts/cycle. Bayesian shrinkage prevents the
bandit from declaring a winner because one post got 1–2 lucky clicks.

**Cold start problem:** for the first ~2 weeks you'll have almost no conversions. Use a
**shrinkage weight**: `w_money = min(1, total_orders_all_time / 20)`, and blend:

```
score = w_money * money_score + (1 - w_money) * engagement_score
```

So it starts by learning "what gets attention" and smoothly transitions to "what gets paid".

**Bandit:** Thompson sampling with Beta priors per lever value, plus a separate table for full
combos. Rewards are normalized to [0,1] by min-max within cycle. Decay old evidence:
`n *= 0.9, reward *= 0.9` every cycle so the model stays current with what Threads is boosting
this month.

> **Thompson sampling** is a way to pick actions under uncertainty. Instead of
> saying "format=flash_story has a score of 0.42," it says "format=flash_story
> probably has a score somewhere between 0.28 and 0.56 — we are 95% sure."
> Then it draws a random number from that range each time. A format with 2
> samples has a wide range (uncertain), so sometimes it draws high and gets
> chosen (exploration). A format with 50 samples has a narrow range (confident),
> so it reliably draws near its true value (exploitation). This naturally
> balances trying new things against sticking with what works.
>
> **Epsilon-greedy** is the simpler version used for full combo selection:
> 75% of the time pick the best-known combo, 25% of the time pick randomly.
>
> **Decay** means the system gradually "forgets" old data. If you set
> `n *= 0.9` every cycle, a post from 10 cycles ago counts for 35% as much
> as a post from yesterday. This keeps the system responsive to trends.

**Statistical honesty:** with 5 posts/day you get 15 posts per cycle. That is *not* enough to
declare a winner at the full-combo level. That's why scoring updates **marginal lever stats**
(format, angle, tone, intensity, length independently) — those get 15 samples per cycle each and
converge in ~4–6 cycles. Full-combo stats are only used once a combo has n ≥ 4.

---

## 6. Tracking (this is where most people fail)

You cannot read Shopee clicks from Threads. Build a 40-line redirector — it is the highest ROI
component in this whole system.

```
Post 12 comment says:  🔗 r.yourdomain.com/p/8fK2q
redirector:
  GET /p/:slug
    → look up slug → post_uid, affiliate_url
    → INSERT click (post_uid, ts, ua, referer, ip_hash, is_bot)
    → 302 to affiliate_url + "&sub_id=" + post_uid   (Shopee SubId, alphanumeric)
```

Now you get:
- **clicks per post** (real, immediate, no waiting for Shopee)
- **bot filtering** (Meta's link preview crawler will hit it — filter `facebookexternalhit`,
  `Threads`, `meta-externalagent` UAs, and dedupe by ip_hash within 60s)
- **sub_id** flowing into Shopee's conversion report → you can join orders back to the exact post
  → back to the exact lever combination. This closes the loop from "tone=deadpan" to "RM 4.30".

Shopee Affiliate supports a single SubId (alphanumeric). Use a short base36 post id, e.g. `p8fk2q`.
**Pull conversions from the Shopee Affiliate Open API** every 3 days (see `lib/shopee_conversions.js`
→ `pullConversions`): it calls `conversionReport` and maps each node's `utmContent` (= the sub_id you
set = `post.uid`) onto `conversions.post_uid`, upserting idempotently on `order_id`. Run it from the
L3 evaluate loop, a cron, or `node bin/shopee.mjs sync`. If you would rather upload the affiliate
CSV by hand, POST normalized rows to `POST /api/import/conversions`
(`{ "rows": [ { order_id, post_uid, commission, status, ... } ] }`) — that is the manual fallback
path and needs no API keys.

Also track, per post: hour-of-day, day-of-week, asset ids, media_type (`TEXT`/`IMAGE`/`CAROUSEL`/`VIDEO`/`MIXED_CAROUSEL`), character count,
emoji count, whether a hashtag was used, seconds between post and CTA reply. All of these become
extra levers you can analyze later — store them even before you optimize them.

---

## 7. Anti-ban / account-safety rules (bake these into the workflow)

- Max 5 posts/day even though the API allows 250. Never burst.
- Jitter every schedule ±18 min; skip a slot entirely 8% of the time (real humans are irregular).
- One "non-commercial" post per day: `sell_intensity=0`, no link in comment at all. Keeps the
  account from looking like a pure link farm and Threads' ranking rewards it.
- Rotate images; never post the same image twice within 10 days. Text-only posts sidestep this
  constraint entirely, which is a quiet advantage when you have few images.
- Never post the identical CTA text twice — 30-variant pool + LLM paraphrase.
- Reply to real human comments (optional L4 workflow: fetch replies, LLM drafts, you approve in
  the UI). This is a large reach multiplier on Threads.
- Refresh the long-lived token every 25 days (cron) — it expires at 60.
- Check `threads_publishing_limit` before every publish; back off exponentially on 429/4xx.

---

## 8. What you build, in order (don't build it all at once)

| Phase | Days | Deliverable | Stop-and-check |
|---|---|---|---|
| **P0** | 1 | Meta app + Threads tester access + long-lived token, post one **text** post manually via curl | A post appears on your profile |
| **P1** | 1 | Postgres schema + docker-compose up | `psql` shows tables |
| **P2** | 1 | Redirector service + Cloudflare tunnel hostname | `r.domain/p/test` redirects & logs |
| **P3** | 0 | Intake — **already built** into the KB service; open `/product.html` for JPG/PNG images or call `POST /api/products` for backend media formats | Product row created; images/description optional as allowed by validation |
| **P4** | 2 | `wf2_generate` with levers + QA | 5 queued posts that read like a human wrote them |
| **P5** | 1 | `wf3_publish` with reply CTA | Live posts with link in comment |
| **P6** | 2 | `wf4_evaluate` + bandit + dashboard | First cycle report after 3 days |
| **P7** | ongoing | Shopee conversion ingest, reply-management, image variant generation | Money score active |

Do **not** skip P2. Without click tracking the whole learning loop is optimizing likes, and likes
do not pay you.

---

## 9. Honest risk list

1. **Meta App Review.** `threads_content_publish` + `threads_manage_insights` need review for
   production. For a single account (yours), add yourself as a **Threads Tester** — no review
   needed, works indefinitely. This is the path you want.
2. **Threads may throttle repetitive affiliate accounts.** Mitigated by §6, but plan for a second
   account (each has its own 250/day quota) and never cross-post identical copy.
3. **Shopee conversion data lag** is 1–3 days and can be reversed on returns. Score on a 7-day
   lag for money, 3-day for engagement.
4. **LLM drift**: your "not templated" rules will slowly get gamed by the model. Re-read 10 posts
   yourself every 2 weeks and add new phrases to the banned list. Keep the banned list in the DB,
   editable from the UI, not hardcoded.
5. **15 posts per cycle is small-n.** Resist the urge to trust the 3-day report. Trust the 5th one.

---

## Official references

The architectural claims in this document map to these official specs:

**Threads API (Meta)**

- Endpoint overview and versions (`graph.threads.net` / `graph.threads.com`, `/v1.0/...`): https://developers.facebook.com/docs/threads/overview
- OAuth 2.0 user access tokens (short-lived 1h, long-lived 60d, refresh): https://developers.facebook.com/docs/threads/get-started/long-lived-tokens
- Publishing flow — create container → `threads_publish` (TEXT / IMAGE / VIDEO / CAROUSEL, 30s recommended wait): https://developers.facebook.com/docs/threads/posts
- Publishing endpoint reference (parameter tables for `/threads` and `/threads_publish`): https://developers.facebook.com/docs/threads/reference/publishing
- Insights metrics (`views`, `likes`, `replies`, `reposts`, `quotes`): https://developers.facebook.com/docs/threads/insights
- Replying + conversation controls (self-reply, hide, replies endpoint): https://developers.facebook.com/docs/threads/reply-control
- User profile endpoint (`GET /v1.0/me?fields=id,username`): https://developers.facebook.com/docs/threads/profile
- Rate limits (content-publishing quota, `threads_publishing_limit`): https://developers.facebook.com/docs/threads/overview
- Error codes and troubleshooting (error 9004 media fetch, container status): https://developers.facebook.com/docs/threads/troubleshooting
- Text post 500-character limit, emoji counting, link preview behavior: https://developers.facebook.com/docs/threads/posts#single-thread-posts

**Cloudflare**

- Tunnel / `cloudflared` reference (token-based auth, no inbound ports): https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
- Tunnel public hostnames (routing to internal services): https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/public-hostnames/
- R2 S3-compatible API (SigV4, `PUT` object, endpoints of the form `<ACCOUNT_ID>.r2.cloudflarestorage.com`): https://developers.cloudflare.com/r2/api/s3/api/
- R2 public buckets & r2.dev subdomains: https://developers.cloudflare.com/r2/buckets/public-buckets/
- R2 free-tier limits (10 GB storage / 10M reads): https://developers.cloudflare.com/r2/platform/pricing/

**OpenAI-compatible chat/embeddings (we speak this protocol regardless of which provider you pick)**

- Chat completions: https://platform.openai.com/docs/api-reference/chat
- Embeddings: https://platform.openai.com/docs/api-reference/embeddings
- Gemini's OpenAI-compatible endpoint: https://ai.google.dev/gemini-api/docs/openai

**Docker / Postgres / n8n**

- Compose file reference (services, networks, depends_on): https://docs.docker.com/reference/compose-file/
- PostgreSQL 16 docs (JSONB, CTEs, exclusion constraints we use for locks): https://www.postgresql.org/docs/16/
- n8n hosting + env-vars (Postgres backend, execution pruning, queue-mode caveats): https://docs.n8n.io/hosting/configuration/
