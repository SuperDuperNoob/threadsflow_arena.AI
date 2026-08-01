# n8n workflows — node by node

Current automation surfaces. Some are n8n workflows; intake and conversion sync are services/CLI.

```
wf0_token_refresh   n8n Cron 25d      keep the Threads long-lived token alive
wf1_intake          NOT N8N           built into the KB service, see below
wf2_generate        n8n Cron 03:00    make scheduled posts and send them to review
wf3_publish         n8n Cron */5min   publish approved/auto-published posts + CTA reply
wf4_evaluate        n8n Cron 3d 02:00 metrics → scores → bandit update → breeding
wf5_conversions     Docker service    shopee-sync runs code/CLI every 12h (optional)
wf6_persona         n8n Cron 03:30    no-link warm-up persona posts
wf7_l4_reply        n8n Cron 4h       on-post comment replies
wf6_karma           DRAFT only        on hold for Meta public search / third-party commenting API
```

`bootstrap_n8n.sh` creates/imports the n8n owner account, imports the `Postgres threadsflow`
credential with fixed id `PG`, and imports workflow JSONs. No Threads or LLM n8n credential is
required: Threads tokens live in the `settings` table and LLM HTTP nodes read `settings.llm`.
Shopee conversions come from the **Shopee Affiliate Open API**, not an n8n credential —
supply `SHOPEE_API_APP_ID` / `SHOPEE_API_SECRET` (env, or the `settings` rows
`shopee_app_id` / `shopee_app_secret`); the sync runs from code/CLI, see wf5 below.
Store the Threads token in the `settings` table row `threads_token`, not in the workflow, so
wf0 can rotate it.

---

## wf1_intake — ALREADY BUILT, not an n8n workflow

**Do not build this.** Product intake is a real endpoint in the KB service
(`services/kb/server.js` → `POST /api/products`, form at `/product.html`). It is already
written, tested, and deployed by `docker compose up`. Nothing to import.

It accepts three shapes; only the affiliate link is universally required. The optional
`product_url` can be added to any shape for enrichment only:

| Shape | `media_mode` | Notes |
|---|---|---|
| affiliate link + browser images (1–4 JPG/PNG) | `images` | current browser UI path; vision pass runs per image |
| affiliate link + browser images + description | `images` | richest browser input |
| affiliate link + backend media upload (JPG/PNG/WebP/MP4/MOV, up to 20 files) | `images` | accepted by `POST /api/products`; video publishing is not yet safe in `wf3_publish` |
| affiliate link + description (≥80 chars) | `text` | no media anywhere in the pipeline |
| affiliate link alone | — | **rejected**, with a message explaining what to add |

What it does internally:

```
POST /api/products (multipart)
   ↓
validate            affiliate link required; optional product_url must be http(s);
                    description >= 80 chars ONLY when no images
   ↓
INSERT products     uid, affiliate_url, product_url, media_mode, description, notes
                    ← transaction commits HERE
   ↓
upload media        browser: 0-4 JPG/PNG; API: 0-20 JPG/PNG/WebP/MP4/MOV -> Cloudflare R2 -> product_images(media_kind)
   ↓  (everything below is post-commit and allowed to fail)
enrich              Shopee Open API (productOfferV2) when keys are set, using product_url
                    first when present; OG tags from product_url/affiliate_url + your
                    description + notes
                    -> {concrete_details[], sensory_details[], detail_confidence, price, persona}
   ↓
vision pass         intended for images -> product_images.vision_desc; current server does not pass media_kind into describeImage()
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
     media_type is gated by product_images.media_kind counts — the bandit tries not to
     choose something the product cannot produce:
       0 media files          -> TEXT
       images only            -> TEXT | IMAGE | CAROUSEL (carousel needs 2+ images)
       exactly 1 video only    -> TEXT | VIDEO
       image+video mix         -> TEXT | IMAGE | VIDEO | CAROUSEL | MIXED_CAROUSEL
     Products WITH media still draw TEXT sometimes. That is deliberate: it is
     the only way to learn whether the visual was helping.
   ↓
[Code: persona picker]                            → 1-3 Malaysian cadence snippets
                                                    (code/persona_picker.js, optional corpus)
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
[HTTP LLM: WRITE]          temp 1.0   → draft            (prompts/writer.md)
   ↓
[HTTP LLM: EDIT]           temp 0.7   → human-pass       (prompts/editor.md)
   ↓
[HTTP LLM: EMBED]          text-embedding-3-small → vector
   ↓
[Code: QA gate]            regex bans, length band, emoji cap, opener check,
                           cosine similarity threshold       (code/qa.js)
                           settings.qa is loaded at the start. `qa.js` directly uses
                           hashtag_probability, max_emoji, and max_similarity; the seeded
                           max_chars, similarity_lookback, and max_retries values are present
                           in config but not all are directly referenced by the current JS.
   ├─ FAIL → log QA rejection; current JSON does not contain a full regenerate loop node chain
   └─ PASS ↓
[Code: pick CTA]           random enabled cta_variant, least used first, LLM paraphrase 50%
   ↓
[Code: build tracked url]  https://r.domain/p/{post_uid}
   ↓
[Postgres: INSERT posts]   status='pending_review', review_timeout_at = scheduled_at - interval '120 minutes'
   ↓
[Postgres: INSERT post_review]   status='pending_review'
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
[Postgres: Fetch due post + timeout sweep]
           - Updates overdue pending_review posts (past review_timeout_at and not locked) to 'auto_published'
           - Selects posts WHERE status IN ('approved', 'auto_published') AND scheduled_at <= now()
             AND (review_locked_until IS NULL OR review_locked_until < now())
           ORDER BY scheduled_at LIMIT 1
   ↓ (no rows → NoOp)
[HTTP GET] graph.threads.net/v1.0/{user_id}/threads_publishing_limit?fields=quota_usage,config
   ↓
[IF quota_usage > 200] → [Postgres: status='skipped', fail_reason='quota'] → end
   ↓
[Postgres: status='publishing']    ← lock, prevents double-post if a run overlaps
   ↓
[Code: Quota guard]  resolves the FINAL media_type. Trusts posts.media_type but verifies
                     against the public URLs that actually resolved:
                       any non-TEXT type with 0 urls  → downgrade to TEXT
                       CAROUSEL with only 1 url       → downgrade to IMAGE
                       IMAGE with >1 url              → truncate to 1
                     A dead CDN link costs you nothing; the post still ships as text.
                     NOTE: this code does not distinguish image_url vs video_url.
   ↓
[Switch: Route by media type]
 ├─ TEXT     → POST /threads  media_type=TEXT&text=body
 ├─ CAROUSEL → [Code: Split images] → POST /threads media_type=IMAGE&is_carousel_item=true&image_url=..
 │             → POST /threads media_type=CAROUSEL&children=id1,id2,..&text=body
 └─ fallback output named IMAGE
              → POST /threads  media_type=IMAGE&image_url=..&text=body
   ↓
[Merge container id]   (3 inputs: TEXT, IMAGE, CAROUSEL)
   ↓
[Wait]  35s for IMAGE/CAROUSEL fallback, 3s for TEXT — fixed wait only; no container status polling
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

**Video/mixed gap in the current workflow:** migration 020 and `bandit.js` can produce `VIDEO`
and `MIXED_CAROUSEL`, but `wf3_publish.json` has no `Create VIDEO container` node, no mixed
carousel child splitter that chooses `image_url` vs `video_url`, and no async status polling loop.
A correct video implementation needs:

1. `VIDEO` branch → `POST /threads` with `media_type=VIDEO` and `video_url=<public url>`.
2. `MIXED_CAROUSEL` branch → create child containers with `media_type=IMAGE` or `VIDEO` plus
   `is_carousel_item=true`, then parent `POST /threads media_type=CAROUSEL&children=...`.
3. Poll `GET /v1.0/{container_id}?fields=status,error_message` until `status == 'FINISHED'`
   before calling `/threads_publish`, with timeout and error logging.

**The DB is the last line of defence.** After migration 020, `posts_media_consistency_chk` enforces
`TEXT ⇒ 0 assets`, `IMAGE ⇒ exactly 1`, `CAROUSEL ⇒ 2–20`, `VIDEO ⇒ exactly 1`, and
`MIXED_CAROUSEL ⇒ 2–20`. The constraint does not validate whether the referenced asset id is an
image or a video; `wf2_generate` does that with `product_images.media_kind` filters.

Base URL: `https://graph.threads.net/v1.0` (Meta also serves `graph.threads.com`).
Always send the token as `access_token` query param. Enable **Retry On Fail** (3×, 5s) on every
HTTP node, and **Continue On Fail** on the publish node so the error branch can record it.

**Canary checkpoints (docs/08-72h-canary.md).** The shipped workflow JSONs also write
`run_log` rows at key steps — wf2: slot built, LLM call failed, post queued; wf3: due post
fetched, quota checked at lock, container created, post published, CTA skipped/published,
publish failure. These are plain Postgres inserts (CTEs on existing nodes plus three small
logging nodes), never n8n execution data, and they store only uids/statuses/error messages —
no tokens, no full post bodies. `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none` stays on in production.

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
[Code: score]                     Bayesian shrinkage scoring              (code/scoring.js)
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

**Now built on the Shopee Affiliate Open API** (GraphQL, `open-api.affiliate.shopee.com.my/graphql`).
You need an App ID + API Key from the affiliate dashboard → *Open API* section, stored as
`SHOPEE_API_APP_ID` / `SHOPEE_API_SECRET` (or the `settings` rows `shopee_app_id` /
`shopee_app_secret`).

What it does: calls `conversionReport` for the last 7 days, maps each node's `utmContent`
(the sub_id your redirector sets = `post.uid`) onto `conversions.post_uid`, and upserts
idempotently on `order_id`. One row per order; commission + actual GMV come from the order
items. Pagination chains on `scrollId` (valid 30s) so it stays inside the window.

Three ways to run it:

1. **From code (recommended):** `lib/shopee_conversions.js` → `pullConversions({ pool })`.
   Call it from the L3 evaluate loop, or as its own cron:
   ```bash
   DATABASE_URL=... SHOPEE_API_APP_ID=... SHOPEE_API_SECRET=... \
     node bin/shopee.mjs sync            # add --validate to also pull the billing-validated report
   ```
2. **From n8n:** an HTTP Request → `POST /api/import/conversions` on the KB service with the
   normalized rows (this is the keyless fallback — build the rows however you like, e.g. from a
   downloaded CSV). Body: `{ "rows": [ { "order_id": "...", "post_uid": "...", "commission": 4.3, "status": "completed" } ] }`.
3. **Verify keys first:** `node bin/shopee.mjs check` does a sample `productOfferV2` call to
   confirm the signature works before you wire it into a loop.

The learning loop still works without this — it just leans on engagement until `w_money` climbs
from real commission data.

The `docker-compose.yml` already includes a `shopee-sync` service that runs this every 12h
automatically — just set `SHOPEE_API_APP_ID` / `SHOPEE_API_SECRET` in `.env` and
`docker compose up -d`. It self-heals: if keys are missing it retries hourly and starts
syncing the moment you add them.

---

## wf0_token_refresh — Cron every 25 days

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
---

## wf6_karma — no-link engagement loop (Project Draft)

Spec lives at `n8n/workflows/wf6_karma.spec.md` and draft template at `n8n/workflows/wf6_karma_draft.json`. It searches Threads every 6 hours for active
product categories, filters out affiliate/link-bait threads, and posts at most small helpful
one-sentence replies with **no link and no CTA**. This workflow is preserved as a **project draft / future feature** on hold until Meta exposes public search (`GET /v1.0/search`) and third-party reply posting endpoints. Active engagement is handled via **Loop L4 On-Post Engagement** (`docs/07-l4-reply-loop.md`).

---

## Official references for every endpoint and setting used in the workflows

**Threads Graph API — what wf0/wf3/wf4/wf6 call**

- Auth window + short-lived token exchange (payload shapes match what wf0 handles): https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions
- Long-lived tokens and `refresh_access_token` / `th_refresh_token` (what wf0 calls every 25d): https://developers.facebook.com/docs/threads/get-started/long-lived-tokens
- Publishing reference (`POST /{user-id}/threads`, `POST /{user-id}/threads_publish`, container params, reply-to via `reply_to_id`): https://developers.facebook.com/docs/threads/reference/publishing
- Posts guide (TEXT/IMAGE/VIDEO/CAROUSEL steps, 30s wait recommendation, 20-image carousel cap, 500-char text limit): https://developers.facebook.com/docs/threads/posts
- Insights (`GET /{media_id}/insights?metric=views,likes,replies,reposts,quotes`): https://developers.facebook.com/docs/threads/insights
- Conversation / replies endpoints (read replies, post replies, hide — used by L4): https://developers.facebook.com/docs/threads/reply-control
- Publishing limits / rate limits (`/threads_publishing_limit`, 250/24h): https://developers.facebook.com/docs/threads/overview
- Profile (`GET /v1.0/me?fields=id,username`): https://developers.facebook.com/docs/threads/profile
- Error codes: https://developers.facebook.com/docs/threads/troubleshooting

**Shopee Affiliate Open API — what wf5 calls**

Shopee does not host a single canonical public doc page; use the affiliate dashboard's
*Open API* section for the current GraphQL endpoint
(`https://open-api.affiliate.shopee.com.my/graphql`) and the App ID / API Key pair. The
client in `lib/shopee.js` follows the contract described in the Shopee Affiliate Open API
spec available inside the affiliate portal.

**Cloudflare R2 — what the KB service calls during intake**

- S3-compatible API (SigV4, PUT object): https://developers.cloudflare.com/r2/api/s3/api/
- R2 API tokens (scoped permissions, access key + secret): https://developers.cloudflare.com/r2/api/s3/tokens/

**n8n itself**

- Credentials (Postgres, HTTP header/basic): https://docs.n8n.io/integrations/builtin/credentials/
- Workflow scheduling (cron expressions, timezone): https://docs.n8n.io/schedule-trigger/
- Configuration / environment variables referenced in §"n8n instance settings": https://docs.n8n.io/hosting/configuration/environment-variables/
- Execution data & pruning (why `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none` is set): https://docs.n8n.io/hosting/configuration/executions/

**OpenAI-compatible LLM — what wf2's HTTP nodes call**

- Chat completions: https://platform.openai.com/docs/api-reference/chat
- Embeddings: https://platform.openai.com/docs/api-reference/embeddings
