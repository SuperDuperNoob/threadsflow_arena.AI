# n8n workflows — node by node

Five workflows. Keep them separate; call each other with **Execute Workflow** so you can rerun
one piece without touching the rest.

```
wf0_token_refresh   Cron  50d      keep the Threads long-lived token alive
wf1_intake          Webhook        product + images → DB
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

## wf1_intake — Webhook

```
[Webhook POST /intake]
   ↓
[Function: validate]           affiliate_url present, 2–4 images, size < 8MB, jpg/png only
   ↓
[Postgres: INSERT product]     RETURNING id, uid
   ↓
[Split In Batches: images]
   ├─ [HTTP/S3: upload to R2]  key = products/{uid}/{n}.jpg  → public_url
   ├─ [HTTP: 9router vision]   "Describe literally what is in this photo in 1 sentence,
   │                            Indonesian, mention colour, setting, lighting, framing."
   └─ [Postgres: INSERT product_images]
   ↓
[HTTP: enrichment]             option A: Apify shopee actor with the item URL
                               option B: GET the affiliate URL, parse og:title/og:image/price
   ↓
[LLM: normalize enrichment]    → {name, price_idr, rating, sold, top_reviews:[3 short quotes],
                                  category, target_persona, 5 concrete_details}
   ↓
[Postgres: UPDATE products SET name, enrichment]
   ↓
[Respond to Webhook]           {product_uid, images: n, enrichment}
```

**`concrete_details` matters more than anything else here.** Force the enrichment LLM to output
5 concrete, checkable facts (weight, cable length, capacity, material, warranty, real review
sentence). Every generated post must use at least one. That single rule is what stops copy
from being generic.

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
                                                    sell_intensity, length_band  (code/bandit.js)
   ↓
[Postgres: pick image(s)]  ORDER BY use_count ASC, last_used_at ASC NULLS FIRST
                           WHERE last_used_at IS NULL OR last_used_at < now() - interval '10 days'
   ↓
[Postgres: last 30 posts]  body, embedding  (anti-repetition context)
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
[IF is_carousel]
 ├─ true:  [Loop images] POST /threads  media_type=IMAGE&is_carousel_item=true&image_url=..
 │         [Merge] → POST /threads media_type=CAROUSEL&children=id1,id2&text=body
 └─ false: POST /threads  media_type=IMAGE&image_url=..&text=body
   ↓
[Wait 35s]
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
```

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

> **Cycle 7 · 15 posts · 41.2k views · 388 clicks (0.94% CTR) · 6 orders · Rp 71.400**
> Money weight is now 0.30, so decisions are still 70% engagement-driven.
> **Up:** tone=deadpan (+38% vs cycle mean, n=11 lifetime), format=honest_review (+51%, n=6),
> sell_intensity=1 beats 2 on CTR by 1.7×.
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
GENERIC_TIMEZONE=Asia/Jakarta
NODE_OPTIONS=--max-old-space-size=1024
DB_TYPE=postgresdb                     # never SQLite for this
```
Do **not** enable queue mode — you don't have the RAM for Redis + workers, and 5 posts/day
doesn't need it.
