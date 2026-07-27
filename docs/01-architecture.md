# ThreadsFlow — Architecture & Flow

> **This is the technical deep-dive.** If you are setting up the system for the
> first time, read `docs/00-START-HERE.md` and `docs/03-setup-runbook.md` instead.

Goal: you drop **1 affiliate URL, plus images and/or a description** into a small web form.
The system then runs forever by itself: writes non-templated copy, posts to Threads ~5×/day, drops the affiliate link in the
first comment, measures what worked, and every 3 days re-invests posting slots into the winning
styles — per product and globally.

---

## 0. The mental model (read this first)

This is **not** "an n8n workflow that posts". It is a small **multi-armed bandit content machine**
with 4 loops.

> **Multi-armed bandit:** imagine a row of slot machines. You have limited coins.
> You do not know which machine pays best. So you try them all at first, and as
> you see which ones pay, you shift more coins to the winners while still
> occasionally trying the others to see if they got better. The system does this
> with writing styles instead of slot machines.

| Loop | Period | What it does |
|---|---|---|
| **L0 Intake** | on demand | You submit product + images → normalized into `products`, images uploaded to public CDN |
| **L1 Generate** | nightly 03:00 | Builds tomorrow's 5 post slots: picks product × angle × hook-family × tone via bandit, writes copy with LLM, QA-checks it, queues it |
| **L2 Publish** | 5×/day (jittered) | Publishes container → post → waits → posts CTA + tracked affiliate link as **self-reply** |
| **L3 Learn** | every 3 days 02:00 | Pulls insights + Shopee conversions, scores each post, updates bandit weights, kills losing arms, breeds variations of winners |

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
   ui.yourdomain             n8n.yourdomain              r.yourdomain
   (Caddy → UI)              (n8n editor, protected)     (link redirector)
        │                          │                           │
   ┌────▼──────┐            ┌──────▼──────┐             ┌──────▼──────┐
   │  ui       │            │    n8n      │             │ redirector  │
   │ Node/Vite │            │  (queue     │             │  tiny Node  │
   │  ~150MB   │            │   mode off) │             │   ~40MB     │
   └────┬──────┘            └──────┬──────┘             └──────┬──────┘
        │                          │                           │
        └───────────┬──────────────┴─────────────┬─────────────┘
                    │                            │
             ┌──────▼──────┐              ┌──────▼──────┐
             │ PostgreSQL  │              │ Cloudflare  │
             │  ~400MB     │              │  R2 bucket  │  ← images must be PUBLIC URLs
             └─────────────┘              └─────────────┘
                    │
             ┌──────▼─────────────────────────────┐
             │ LLM: 9router → (Gemini/GPT/Claude) │  ← cheap models, no local inference
             └────────────────────────────────────┘
```

**RAM budget**: n8n 700MB–1GB, Postgres 400MB, UI 150MB, redirector 40MB,
Caddy 30MB, cloudflared 40MB → ~2.1GB peak, leaves headroom. **Do not run a local LLM.**
Use 9router to hit hosted models; a post costs fractions of a cent.

> **Image hosting note (only matters if you upload images):** Threads fetches `image_url`
> server-side, so images must be on a
> publicly reachable HTTPS URL. The system uses Cloudflare R2 with a public bucket
> (free tier, 10 GB storage, zero egress cost — Meta's fetches cost you nothing).
> Do **not** serve them from the VPS directly — you have no open ports and Meta needs to fetch.

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
| **media_type** | TEXT, IMAGE, CAROUSEL — constrained by what the product actually has | 3 |

On top of the levers, each post also carries **1–2 "devices"** drawn from the 60-technique
library (43 hand-written in Malay + 17 mined from your `Books/` folder). Devices are
Thompson-sampled and scored exactly like levers, and 15% of posts deliberately get none so you
can tell whether the library is helping at all. See `docs/04-technique-library.md` and
`docs/05-books.md`.

Combinatorial space = 12×9×7×3×3×3 = **20,412 arms**. You post ~150/month, so you will never repeat
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
  affiliate_url: "https://s.shopee.com.my/xxxx",  // the only universally required field
  images:        [file, ...],                     // 0-4. optional
  description:   "...",                           // required only when images are absent (>=80 chars)
  name:          "optional, LLM fills if blank",
  price_myr:     "optional",
  notes:         "optional: 'untuk mak-mak, harga RM39, free shipping'"
}
```

**Three valid shapes.** `link + images`, `link + images + description`, `link + description`.
Only `link` alone is rejected: with neither a photo nor words there is nothing concrete to write
from, and the LLM would invent details — the exact failure this project exists to prevent.

`products.media_mode` is set to `images` or `text` at intake and drives everything downstream.

The KB service does:
1. Upload any images → Cloudflare R2 (or local) → public URLs → `product_images`. **Skipped entirely
   when none were supplied.**
2. **Enrich**: fetch the OG tags of the affiliate URL (free, no third-party scraper needed) and fold in your
   description + notes → `products.enrichment` JSONB. Emits `concrete_details` (checkable facts)
   and `detail_confidence`. *This is the single biggest quality lever.*
   Shopee blocks datacenter IPs often, so this is best-effort — it falls back to splitting your
   own description into facts, and the product stays fully postable either way.
   **When Shopee Open API keys are configured** (`SHOPEE_API_APP_ID`/`SHOPEE_API_SECRET`), the
   `productOfferV2` query runs first and overlays *authoritative* `price_min`, `commission_rate`,
   `sales` and `rating` onto the enrichment (see `lib/shopee.js` → `enrichProductFromShopee`). The
   OG scrape remains the fallback, so absence of keys never degrades the product.
3. **Vision pass (images only)**: each image → a cheap vision model → `product_images.vision_desc`
   ("close-up of the matte black handle, wooden table, warm light"), so copy **matches the image
   it's paired with**.
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
                                0 images → TEXT only
                                1 image  → TEXT | IMAGE
                                2+       → TEXT | IMAGE | CAROUSEL
                              Products with images still draw TEXT ~15% of the time, so you
                              learn whether the photo was even helping.
         3. SELECT image    → fewest impressions first, round-robin. Skipped for TEXT.
         4. BUILD prompt    → system + product facts + lever instructions
                              + vision_desc (image posts) OR the no-image block (text posts)
                              + last-20-posts anti-repeat list + banned phrase list
         5. LLM call #1     → draft (temp 1.0)
         6. LLM call #2     → critique+rewrite
         7. QA node         → regex bans + length + embedding similarity. Fail → retry ≤3, then
                              fall back to a different arm.
         8. Generate CTA comment text (separate style pool, 30 variants, also randomized)
         9. Build tracked link: base affiliate URL + sub_id = post_uid  (see §5)
        10. INSERT into `posts` (status='queued', scheduled_at, all lever values, prompt_hash)
```

Cost: 5 posts × 3 calls × ~1.5k tokens ≈ nothing (< $0.01/day on a cheap model).

### L2 — Publish (scans the queue every 5 minutes)

```
1. GET /{threads-user-id}/threads_publishing_limit   → abort if quota_usage > 200
2. Branch on posts.media_type:
     TEXT     → POST /threads  media_type=TEXT & text=<copy>
     IMAGE    → POST /threads  media_type=IMAGE & image_url=<public url> & text=<copy>
     CAROUSEL → POST /threads  media_type=IMAGE & is_carousel_item=true  (once per image)
                then POST /threads media_type=CAROUSEL & children=<ids> & text=<copy>
   If media_type claims images but none resolve (deleted file, dead CDN), downgrade to TEXT.
3. WAIT 35s for IMAGE/CAROUSEL, 3s for TEXT   (only media needs async processing)
4. POST /v1.0/{user-id}/threads_publish?creation_id=...   → media_id
5. WAIT 45–120s (random) — looks human, and lets the post get initial distribution
6. Create reply container: media_type=TEXT, text=<cta + tracked link>, reply_to_id=<media_id>
7. Publish reply → reply_id
8. UPDATE posts SET status='published', threads_media_id, threads_reply_id, published_at
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

## 4. Scoring — the part that decides whether you make money

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

score = 0.55 * z(EPM) + 0.25 * z(CTR) + 0.20 * z(ENG)
```

z() = z-score within the same evaluation cycle (so you compare against *that* cycle's baseline,
not against your best week ever).

> **Z-score** means "how far above or below average was this, measured in
> standard deviations." This prevents a post in a high-traffic week from
> looking permanently better than a post in a slow week. You always compare
> against peers from the same 3-day window.

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

## 5. Tracking (this is where most people fail)

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

Also track, per post: hour-of-day, day-of-week, image_id, media_type (TEXT/IMAGE/CAROUSEL), character count,
emoji count, whether a hashtag was used, seconds between post and CTA reply. All of these become
extra levers you can analyze later — store them even before you optimize them.

---

## 6. Anti-ban / account-safety rules (bake these into the workflow)

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

## 7. What you build, in order (don't build it all at once)

| Phase | Days | Deliverable | Stop-and-check |
|---|---|---|---|
| **P0** | 1 | Meta app + Threads tester access + long-lived token, post one **text** post manually via curl | A post appears on your profile |
| **P1** | 1 | Postgres schema + docker-compose up | `psql` shows tables |
| **P2** | 1 | Redirector service + Cloudflare tunnel hostname | `r.domain/p/test` redirects & logs |
| **P3** | 0 | Intake — **already built** into the KB service; just open `/product.html` | Product row created; images optional |
| **P4** | 2 | `wf2_generate` with levers + QA | 5 queued posts that read like a human wrote them |
| **P5** | 1 | `wf3_publish` with reply CTA | Live posts with link in comment |
| **P6** | 2 | `wf4_evaluate` + bandit + dashboard | First cycle report after 3 days |
| **P7** | ongoing | Shopee conversion ingest, reply-management, image variant generation | Money score active |

Do **not** skip P2. Without click tracking the whole learning loop is optimizing likes, and likes
do not pay you.

---

## 8. Honest risk list

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
