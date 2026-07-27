# n8n workflows — node by node

Five workflows. Keep them separate; call each other with **Execute Workflow** so you can rerun
one piece without touching the rest.

```
wf0_token_refresh   Cron  50d      keep the Threads long-lived token alive
wf1_intake          NOT AN N8N WORKFLOW — built into the KB service, see below
wf2_generate        Cron 03:00     make tomorrow's 5 posts
wf3_publish         Cron */5min    publish queue + CTA reply
wf4_evaluate        Cron 3d 02:00  metrics → scores → bandit update → breeding
wf5_conversions     Cron 12h       Shopee conversions → DB   (optional at first)
```

Credentials to create in n8n: `Postgres threadsflow`, `HTTP Header Auth threads`
(not needed — token goes in query), `HTTP Request 9router`, `Apify`, `S3/R2`.
Store the Threads token in the `settings` table row `threads_token`, not in the workflow, so
wf0 can rotate it.

---

## wf1_intake — ALREADY BUILT, not an n8n workflow

**Do not build this.** Product intake is a real endpoint in the KB service
(`services/kb/server.js` → `POST /api/products`, form at `/product.html`). It is already
written, tested, and deployed by `docker compose up`. Nothing to import.

It accepts three shapes; only the affiliate link is universally required:

| Shape | `media_mode` | Notes |
|---|---|---|
| link + images (1–4) | `images` | vision pass runs per image |
| link + images + description | `images` | richest input |
| link + description (≥80 chars) | `text` | no images anywhere in the pipeline |
| link alone | — | **rejected**, with a message explaining what to add |

What it does internally:

```
POST /api/products (multipart)
   ↓
validate            link required; description >= 80 chars ONLY when no images
   ↓
INSERT products     uid, media_mode, description, notes     ← transaction commits HERE
   ↓
upload images       0-4 files -> R2 / MinIO / local -> product_images   (skipped if none)
   ↓  (everything below is post-commit and allowed to fail)
enrich              OG tags of the affiliate URL + your description + notes
                    -> {concrete_details[], sensory_details[], detail_confidence, price, persona}
   ↓
vision pass         images only -> product_images.vision_desc
```

**Why the commit happens early:** Shopee blocks datacenter IPs frequently and vision calls can
time out. The product is created and postable the instant you submit; enrichment failure
downgrades quality, never availability. Failures land in `run_log` at `warn`.

**`concrete_details` matters more than anything else here.** Checkable facts only — weight,
cable length, capacity, material, warranty, a real review sentence. Every generated post must
use at least one; the QA gate enforces it. For text-only products `sensory_details` does the
same job in place of the photo, and both are derived *strictly* from what you supplied — if the
input is thin the enricher returns fewer facts and sets `detail_confidence='low'` rather than
inventing. A wrong specific is worse than a missing one.

---

## wf2_generate — Cron 03:00

```
[Cron 03:00]
   ↓
[Postgres: load settings + levers + banned_phrases]
   ↓
[Code: build slot plan]                          → 5 items (see code/slot_plan.js)
   ↓  (one item per slot)
[Postgres: candidate products]  SELECT * FROM products
                                WHERE status='active' AND (rest_until IS NULL OR rest_until<now())
   ↓
[Postgres: arm_stats for scope global + product]
   ↓
[Code: bandit pick]                              → product_id, format, angle, tone,
                                                    sell_intensity, length_band, media_type
                                                    (code/bandit.js)
     media_type is gated by the product's real image count — the bandit can never
     choose something the product cannot produce:
       0 images -> TEXT            1 image -> TEXT | IMAGE
       2+ images -> TEXT | IMAGE | CAROUSEL
     Products WITH images still draw TEXT ~15% of the time. That is deliberate: it is
     the only way to learn whether the photo was helping.
   ↓
[Postgres: pick image(s)]  ORDER BY use_count ASC, last_used_at ASC NULLS FIRST
                           WHERE last_used_at IS NULL OR last_used_at < now() - interval '10 days'
                           LIMIT depends on media_type; returns 0 rows for TEXT posts
                           (node has alwaysOutputData=true so the branch does not stall)
   ↓
[Postgres: last 30 posts]  body, embedding  (anti-repetition context)
   ↓
[Postgres: techniques]     SELECT * FROM techniques WHERE enabled
   ↓
[Code: technique picker]   1-2 compatible devices, Thompson-sampled, 15% control group
                                                    (code/technique_picker.js)
   ↓
[HTTP 9router: WRITE]      temp 1.0   → draft            (prompts/writer.md)
   ↓
[HTTP 9router: EDIT]       temp 0.7   → human-pass       (prompts/editor.md)
   ↓
[HTTP 9router: EMBED]      text-embedding-3-small → vector
   ↓
[Code: QA gate]            regex bans, length band, emoji cap, opener check,
                           cosine similarity < 0.86       (code/qa.js)
   ├─ FAIL → [Code: mutate arm] → loop back to WRITE (max 3), then pick a different arm
   └─ PASS ↓
[Code: pick CTA]           random enabled cta_variant, least used first, LLM paraphrase 50%
   ↓
[Code: build tracked url]  https://r.domain/p/{post_uid}
   ↓
[Postgres: INSERT posts]   status='queued'
   ↓
[Postgres: INSERT technique_usage]   post_id x device_ids  (attribution for wf4)
```

### Breeding (what makes cycle N+1 better than cycle N)

wf4 writes `next_cycle_plan` into `settings`. wf2 reads it and for **60% of slots** takes a
"breed" instruction instead of a fresh bandit draw:

```json
{"mode":"breed","parent_post_id":812,"keep":["format","tone"],"mutate":"angle"}
```

The writer prompt then also receives the parent post body with:
*"This post performed well. Write a NEW post that keeps the same rhythm and voice but a
completely different situation, different opening words, and a different persuasion angle.
Do not paraphrase it."*

40% stays pure exploration so you never collapse into one style.

---

## wf3_publish — Cron every 5 minutes

```
[Cron */5 * * * *]
   ↓
[Postgres] SELECT * FROM posts WHERE status='queued' AND scheduled_at <= now()
           ORDER BY scheduled_at LIMIT 1
   ↓ (no rows → NoOp)
[HTTP GET] graph.threads.net/v1.0/{user_id}/threads_publishing_limit?fields=quota_usage,config
   ↓
[IF quota_usage > 200] → [Postgres: status='skipped', fail_reason='quota'] → end
   ↓
[Postgres: status='publishing']    ← lock, prevents double-post if a run overlaps
   ↓
[Code: Quota guard]  resolves the FINAL media_type. Trusts posts.media_type but verifies
                     against the image URLs that actually resolved:
                       claims IMAGE/CAROUSEL but 0 urls  → downgrade to TEXT
                       claims CAROUSEL but only 1 url    → downgrade to IMAGE
                       claims IMAGE but >1 url           → truncate to 1
                     A dead CDN link costs you nothing; the post still ships as text.
   ↓
[Switch: Route by media type]
 ├─ TEXT     → POST /threads  media_type=TEXT&text=body
 ├─ CAROUSEL → [Code: Split images] → POST /threads media_type=IMAGE&is_carousel_item=true&image_url=..
 │             → POST /threads media_type=CAROUSEL&children=id1,id2,..&text=body
 └─ IMAGE    → POST /threads  media_type=IMAGE&image_url=..&text=body
   ↓
[Merge container id]   (3 inputs, one per branch)
   ↓
[Wait]  35s for IMAGE/CAROUSEL, 3s for TEXT — only media needs async processing,
        so text posts publish ~30s faster
   ↓
[HTTP POST] /threads_publish?creation_id=...   → media_id
   ├─ error → [Postgres: status='failed', fail_reason] + [run_log] → end
   ↓
[Postgres: UPDATE threads_media_id, published_at, status='published']
   ↓
[IF sell_intensity = 0] → end          (no link comment on the daily non-commercial post)
   ↓
[Wait random 45–120s]
   ↓
[HTTP POST] /threads  media_type=TEXT&text={cta}&reply_to_id={media_id}
[Wait 10s]
[HTTP POST] /threads_publish?creation_id=...   → reply_id
   ↓
[Postgres: UPDATE threads_reply_id, reply_delay_sec]
   ↓
[Postgres: UPDATE product_images SET use_count=use_count+1, last_used_at=now()]
        ← no-op for TEXT posts, since image_ids is empty
```

**The DB is the last line of defence.** `posts_media_consistency_chk` enforces
`TEXT ⇒ 0 images`, `IMAGE ⇒ exactly 1`, `CAROUSEL ⇒ 2–20`. A malformed post cannot be inserted
by wf2, so it can never reach the Threads API and fail opaquely 30 seconds later.

Base URL: `https://graph.threads.net/v1.0` (Meta also serves `graph.threads.com`).
Always send the token as `access_token` query param. Enable **Retry On Fail** (3×, 5s) on every
HTTP node, and **Continue On Fail** on the publish node so the error branch can record it.

---

## wf4_evaluate — Cron every 3 days, 02:00

```
[Cron 0 2 */3 * *]
   ↓
[Postgres: INSERT cycles RETURNING id]
   ↓
[Postgres] SELECT * FROM posts
           WHERE status='published' AND published_at > now() - interval '3 days'
   ↓ loop
[HTTP GET] /{media_id}/insights?metric=views,likes,replies,reposts,quotes
   ↓
[Postgres: INSERT post_metrics]
   ↓ (also re-pull day-7 metrics for posts published 7 days ago → long tail)
[Postgres] aggregate clicks + conversions per post_uid
   ↓
[Code: score]                     z-scores within cycle, shrinkage blend   (code/scoring.js)
   ↓
[Postgres: UPSERT post_scores]
   ↓
[Code: bandit update]             per-lever alpha/beta + decay             (code/bandit.js)
   ↓
[Postgres: UPSERT arm_stats, combo_stats]
   ↓
[Code: technique update]          same alpha/beta fold, n>=6 before judging
                                  (code/technique_picker.js, mode='update')
   ↓
[Postgres: UPSERT techniques]
   ↓
[Code: decide next cycle]         winners→breed list, losers→cooldown,
                                  dead products→resting
   ↓
[Postgres: UPDATE settings SET value=... WHERE key='next_cycle_plan']
   ↓
[LLM: write digest]               plain-language summary of what changed and why
   ↓
[Postgres: UPDATE cycles SET digest, totals]
   ↓
[Optional: Telegram/email you the digest]
```

### The digest you actually read (example)

> **Cycle 7 · 15 posts · 41.2k views · 388 clicks (0.94% CTR) · 6 orders · RM 71.40**
> Money weight is now 0.30, so decisions are still 70% engagement-driven.
> **Up:** tone=deadpan (+38% vs cycle mean, n=11 lifetime), format=honest_review (+51%, n=6),
> sell_intensity=1 beats 2 on CTR by 1.7×, media_type=TEXT beats IMAGE by 1.3× on CTR (n=9).
> **Down:** tone=enthusiast (−44%), format=question_hook (−31%) → cooldown 9 days.
> **Note:** the 19:00 slot is 2.1× the 11:00 slot on views. Consider moving 11:00 → 20:30.
> **Next cycle:** 9 slots breeding from posts #812, #806, #799; 6 slots exploring.

---

## wf5_conversions — Cron 12h

Apify actor `viralanalyzer/shopee-affiliate-products` with `mode=conversions`,
`conversionTimeRangeDays=7`. Map `sub_id` → `posts.uid`, upsert on `order_id`.
If you don't have Shopee Open API keys yet, do this manually: download the affiliate CSV weekly
and POST it to a small `/import/conversions` webhook. The learning loop still works, just with
`w_money` climbing more slowly.

---

## wf0_token_refresh — Cron every 50 days

```
GET https://graph.threads.net/refresh_access_token
    ?grant_type=th_refresh_token&access_token={current}
→ UPDATE settings SET value = new token WHERE key='threads_token'
```
Long-lived tokens last 60 days. Refresh at 50. If this fails, alert yourself — a silently dead
token means 3 days of no posts before you notice.

---

## n8n instance settings for a 2 vCPU / 4GB box

```
EXECUTIONS_DATA_PRUNE=true
EXECUTIONS_DATA_MAX_AGE=168            # hours (7 days)
EXECUTIONS_DATA_SAVE_ON_SUCCESS=none   # keep errors only
EXECUTIONS_DATA_SAVE_ON_ERROR=all
N8N_PAYLOAD_SIZE_MAX=32
GENERIC_TIMEZONE=Asia/Kuala_Lumpur
NODE_OPTIONS=--max-old-space-size=1024
DB_TYPE=postgresdb                     # never SQLite for this
```
Do **not** enable queue mode — you don't have the RAM for Redis + workers, and 5 posts/day
doesn't need it.
