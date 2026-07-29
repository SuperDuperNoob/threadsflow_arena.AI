# wf6_karma — Threads Karma Engagement Loop (PROJECT DRAFT)

> **STATUS: PROJECT DRAFT / FUTURE FEATURE (ON HOLD)**
> 
> **Prerequisite:** Meta currently restricts the official Threads API to managing comments on your own posts (`/v1.0/{media_id}/replies`) and does not expose a global public search API (`/v1.0/search`) or public third-party commenting.
> 
> This specification and its draft template (`n8n/workflows/wf6_karma_draft.json`) are preserved as a **project draft** for future activation when Meta adds public search and third-party commenting APIs.
> 
> *In the meantime, active engagement is handled safely on your own posts via **Loop L4 On-Post Engagement** (`docs/07-l4-reply-loop.md`).*

---

Purpose: stop the account behaving like a post-only affiliate bot. Every 6 hours it performs small, useful, no-link participation around the same product categories the account already posts about.

## Guardrails

- **No affiliate links. No tracked links. No Shopee URL. No CTA.**
- Max 6 comments/day by default.
- Comment only where the account can be helpful from the product/category context.
- Uses Malaysian persona dataset calibration snippets (`persona_snippets` / `dataset-1.json`) for natural Malay phrasing.
- Never imply ownership if the product data does not support it.
- Avoid medical, financial, legal, or safety claims.
- Skip angry/political/NSFW threads.
- Skip competitor sellers and obvious affiliate posts.
- Store every attempted comment in `run_log` or a future `karma_actions` table for audit.

## Schedule

n8n Schedule Trigger:

```text
0 */6 * * *
Timezone: Asia/Kuala_Lumpur
```

## Workflow shape

```text
[Schedule: every 6h (Disabled)]
  → [Postgres: pick 3 product/category seeds]
  → [HTTP: Threads Search API (PLACEHOLDER)]
  → [Code: filter/rank candidate threads]
  → [Split in Batches: top 2 per product]
  → [Persona Calibration: load Malaysian cadence snippets]
  → [LLM: write 1-sentence helpful comment]
  → [Code: no-link/no-spam QA]
  → [HTTP: publish Threads reply/comment (PLACEHOLDER)]
  → [Postgres: run_log audit]
```

## 1) Pick 3 product seeds

Postgres node:

```sql
SELECT id, uid, name,
       COALESCE(enrichment->>'category', notes, name) AS category_hint,
       notes,
       enrichment
  FROM products
 WHERE status='active'
 ORDER BY random()
 LIMIT 3;
```

Search query builder examples:

- `{{category_hint}} tips`
- `{{category_hint}} problem`
- `{{category_hint}} recommendation Malaysia`
- Product-specific: `{{name}} guna macam mana` if the name is generic enough.

## 2) Threads Search API (Pending Meta Release)

HTTP Request node (placeholder; update version/path when Meta releases the Threads public Search API):

```http
GET https://graph.threads.net/v1.0/search
Authorization: Bearer {{$json.token}}
Query:
  q={{$json.search_query}}
  media_type=TEXT
  limit=10
  fields=id,text,username,permalink,timestamp,like_count,reply_count,repost_count
```

## 3) Candidate filter

Keep only threads that pass all rules:

- Text language is Malay or Malaysian English.
- Does **not** contain `shopee`, `s.lazada`, `affiliate`, `voucher code`, `racun link`, `link pls`, `tiktok shop`, `wa.me`, or obvious shortened URLs.
- Not posted by our own account.
- Not a giveaway, complaint escalation, politics, medical/legal advice, or adult content.
- Has enough proof of life: `reply_count + like_count >= 5` or is in top 20% of search results.

Rank score:

```js
score = (reply_count * 3) + like_count + (repost_count * 4) - urlPenalty - affiliatePenalty;
```

Select top **2 non-affiliate threads per product seed**.

## 4) LLM comment prompt (Persona-Calibrated)

System:

```text
You are a normal Malaysian Threads user. Write one helpful reply, not an ad.
No links. No CTA. No hashtags. No emoji unless the source thread uses emoji casually.
Sound like you have one small practical tip, not like a brand.
1 sentence only. Max 180 characters. Same language as the thread.
```

User:

```text
Product/category context:
{{product.name}}
{{category_hint}}
{{notes}}

Thread text:
{{thread.text}}

{{persona_fragment}}

Write a useful 1-sentence comment. It may start with:
- "Yang ni biasanya..."
- "Saya perasan kalau..."
- "Tip kecil je..."
- "Kalau guna benda macam ni..."

Do not mention Shopee, price, discount, link, or affiliate.
```

Good comment examples:

- `Kalau guna yang jenis ni, lap kering dulu sebelum simpan; kalau lembap memang cepat bau.`
- `Tip kecil je: ukur ruang dulu, sebab gambar produk selalu nampak lagi kecil dari saiz sebenar.`
- `Saya perasan benda macam ni lagi tahan kalau jangan terus charge sampai panas sangat.`

Bad examples:

- `Link ada kat bio` — link bait.
- `Saya ada jumpa murah ni` — affiliate intent.
- `Produk ini sangat berkualiti dan wajib dimiliki` — AI-commerce voice.

## 5) QA gate

Reject if comment contains:

```regex
https?:|www\.|shopee|lazada|affiliate|voucher|discount|diskaun|promo|link|bio|DM|game-changer|must-have|viral
```

Reject if:

- More than 1 sentence.
- More than 180 characters.
- Contains a claim not supported by product notes/category.
- Sounds like customer service or a seller.

## 6) Publish (Pending Meta Release)

HTTP Request node (reply/comment endpoint placeholder):

```http
POST https://graph.threads.net/v1.0/{{thread.id}}/replies
Authorization: Bearer {{$json.token}}
Body:
  text={{comment}}
```

## 7) Audit log

```sql
INSERT INTO run_log (workflow, level, message, meta)
VALUES (
  'wf6_karma',
  'info',
  'posted no-link karma comment',
  jsonb_build_object(
    'product_uid', $1,
    'thread_id', $2,
    'permalink', $3,
    'comment', $4,
    'search_query', $5
  )
);
```

## Daily safety caps

Before publishing, check:

```sql
SELECT count(*) AS comments_today
  FROM run_log
 WHERE workflow='wf6_karma'
   AND message='posted no-link karma comment'
   AND ts > now() - interval '24 hours';
```

Skip publish when `comments_today >= 6`.
