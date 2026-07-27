# Setup runbook — from empty VPS to first automated post

Assumes: Debian, Docker + n8n + cloudflared already installed, 4GB/2vCPU.
Total hands-on time: about a day, plus waiting on Meta.

---

## Step 1 — Threads API access (do this FIRST, it gates everything)

You do **not** need App Review because you're posting to your own account.

1. https://developers.facebook.com → **Create App** → use case **"Access the Threads API"**.
2. In the app, add permissions: `threads_basic`, `threads_content_publish`,
   `threads_manage_insights`, `threads_manage_replies`.
3. **App roles → Threads Tester → add your own Threads username.**
   Then accept the invite at threads.net → Settings → Website permissions → Invites.
   *This is the step everyone misses. Without it every call returns an OAuth error.*
4. Set a redirect URI: `https://n8n.yourdomain.com/webhook/threads-oauth`
   (or just use `https://localhost/` and grab the code manually — you only do this once).
5. Get a short-lived token via the auth dialog, then exchange it:

```bash
# short → long lived (60 days)
curl -s "https://graph.threads.net/access_token?grant_type=th_exchange_token\
&client_secret=APP_SECRET&access_token=SHORT_LIVED_TOKEN"

# find your threads user id
curl -s "https://graph.threads.net/v1.0/me?fields=id,username&access_token=LONG_TOKEN"
```

6. **Smoke test before building anything else:**

```bash
TOKEN=...; UID=...
CID=$(curl -s -X POST "https://graph.threads.net/v1.0/$UID/threads" \
  -d "media_type=IMAGE" -d "image_url=https://picsum.photos/1080" \
  -d "text=test" -d "access_token=$TOKEN" | jq -r .id)
sleep 35
curl -s -X POST "https://graph.threads.net/v1.0/$UID/threads_publish" \
  -d "creation_id=$CID" -d "access_token=$TOKEN"
```

If a post appears on your profile, the hard part is done. If not, stop and fix this — no amount
of n8n will help.

---

## Step 2 — Bring up the stack

```bash
git clone <this repo> ~/threadsflow && cd ~/threadsflow/infra
cp .env.example .env
openssl rand -hex 32   # → N8N_ENCRYPTION_KEY
openssl rand -hex 16   # → IP_SALT
openssl rand -base64 24  # → PG_PASSWORD
nano .env

docker compose up -d
# order matters — dependencies flow downward
# NOTE the _my files — those are the Malaysian Malay versions. Using the non-_my ones
# would seed the system in Indonesian, which is the wrong language for your audience.
for f in schema.sql schema_techniques.sql schema_kb.sql \
         seed_levers_my.sql seed_techniques_my.sql mining_questions.sql; do
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < ../db/$f
done

# migrations next — safe to run twice, and required on a fresh install too
for m in 001_optional_media.sql 002_localisation.sql; do
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < ../db/migrations/$m
done

# the Books/ techniques go LAST: they use compatible_media, a column added by migration 001
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow \
  < ../db/seed_techniques_books.sql
```

Store secrets in the DB so workflows read them at runtime:

```sql
INSERT INTO settings (key, value) VALUES
('threads_creds', '{"token":"LONG_TOKEN","user_id":"YOUR_UID","expires_at":"2026-09-25"}'),
('llm', '{"base_url":"http://host.docker.internal:PORT/v1","model_write":"gemini-2.5-flash",
          "model_edit":"gpt-4.1-mini","model_embed":"text-embedding-3-small"}'),
('apify', '{"token":"apify_api_..."}'),
('next_cycle_plan', '[]');
```

> 9router runs on the host, so from inside Docker reach it via `host.docker.internal`
> (add `extra_hosts: ["host.docker.internal:host-gateway"]` to the n8n service) or put 9router
> on the same compose network.

---

## Step 3 — Cloudflare Tunnel hostnames

In Zero Trust → Networks → Tunnels → your tunnel → Public Hostnames:

| Hostname | Service | Access policy |
|---|---|---|
| `n8n.yourdomain.com` | `http://n8n:5678` | **Require your email** |
| `kb.yourdomain.com` | `http://kb:8082` | **Require your email** |
| `r.yourdomain.com` | `http://redirector:8081` | **None — must be public** |
| `cdn.yourdomain.com` | `http://kb:8082` | **None — Meta must fetch images** (skip if text-only) |

Verify: `curl -I https://r.yourdomain.com/healthz` → 200, and
`curl -I https://r.yourdomain.com/p/testuid` → 302.

---

## Step 3b — Cloudflare R2 image hosting (click-by-click)

Threads fetches your images server-side before a post goes live.
If Meta's servers cannot reach the image URL, the post fails with a cryptic
error 9004. You need a publicly reachable HTTPS URL — you cannot host images on
your laptop or behind a login wall.

Cloudflare R2 is the simplest answer. It is Cloudflare's version of Amazon S3:
**object storage** — a place to dump files and fetch them back over HTTPS.
Unlike AWS S3, R2 has **zero egress fees** (Meta downloading your images costs
nothing) and a generous free tier: 10 GB storage, 10 million monthly reads.
For a Threads poster uploading a handful of product photos a week, you will
never exceed the free tier.

> **You do not need to understand S3 or SigV4 deeply.** The code in this repo
> handles all of that. This guide tells you which buttons to click and which
> values to copy-paste. The "what is SigV4" section at the end is optional
> reading for the curious.

### 3b.1 — What you are building

```
Your phone takes a photo
       │
       ▼
  KB web UI (you upload)  ──PUT──▶  Cloudflare R2 bucket  ──▶  public HTTPS URL
       │                            (private writes)            (public reads)
       │                                                              │
       ▼                                                              ▼
  products table                                              Meta's servers fetch
  stores the public URL                                       it when you post
```

The bucket accepts **writes** only from your API token (nobody else can upload).
But it serves **reads** to anyone — including Meta's image-fetching crawler.
This is the "public bucket" pattern and it is exactly what you want.

### 3b.2 — Create the R2 bucket

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → left sidebar → **R2**.
   (If you do not see R2, you may need to add a payment method first — it will
   not be charged on the free tier, but Cloudflare requires one on file.)

2. Click **Create bucket**. Name it `threadsflow`. Leave the default location
   (Automatic). Click **Create bucket**.

3. You now have an empty bucket. Before it can serve images publicly, you need
   to enable public access. Click into your bucket → **Settings** →
   **Public Access**. There are two options:

   | Method | What you get | Best for |
   |---|---|---|
   | **r2.dev subdomain** | `https://pub-abc123.r2.dev` | Testing, or if you do not have a custom domain |
   | **Custom Domain** | `https://cdn.yourdomain.com` | Production — looks cleaner in post URLs |

   **For testing**, enable r2.dev: toggle it on, click **Allow Access**.
   Your public URL prefix is now `https://pub-SOMEHASH.r2.dev`. Write this down.
   It shows at the top of the Public Access settings page.

   **For production**, connect a custom domain: click **Connect Domain**, type
   `cdn.yourdomain.com` (replace with your actual domain). Cloudflare will
   auto-configure the DNS. Your public URL prefix is now
   `https://cdn.yourdomain.com`.

   > ⚠️ **Important:** the bucket name `threadsflow` is NOT part of the public
   > URL when using a custom domain. With `r2.dev`, the bucket name IS in the
   > URL: `https://pub-abc123.r2.dev/threadsflow/<key>`. The code handles both
   > cases — just enter whatever URL prefix you see on the screen.

4. Verify it works. Upload a test file from your terminal:

   ```bash
   # Replace with YOUR public URL prefix (no trailing slash)
   PUBLIC=https://pub-abc123.r2.dev

   echo "hello r2" > /tmp/test.txt

   # Upload using the token you will create in the next step
   curl -X PUT "$PUBLIC/test.txt" \
     -H "Content-Type: text/plain" \
     --data-binary @/tmp/test.txt
   # This will 403 until you create an API token — that is expected.
   ```

### 3b.3 — Create the API token

The API token is a pair of strings: an **Access Key ID** (like a username) and
a **Secret Access Key** (like a password). The code sends these with every
upload to prove it is allowed to write to your bucket.

1. Cloudflare Dashboard → **R2** → **Manage R2 API Tokens** (top right).

2. Click **Create API Token**.

3. Fill in:
   - **Token name**: `threadsflow-kb` (so you remember what it is for)
   - **Permissions**: **Object Read & Write**
   - **Specify bucket(s)**: select `threadsflow` (not "All buckets" — least privilege)
   - Leave TTL at the default, or set "No Expiry" since this is a long-running server token

4. Click **Create API Token**.

5. You will see **one screen** with these values. Copy them now — you cannot
   retrieve the Secret Access Key after closing this screen:

   | On screen | Copy into .env as | Example value |
   |---|---|---|
   | Access Key ID | `S3_KEY` | `abc123...` |
   | Secret Access Key | `S3_SECRET` | `xyz789...` |
   | Endpoint | `S3_ENDPOINT` | `https://ACCTID.r2.cloudflarestorage.com` |
   | Jurisdiction-specific endpoint (use the one shown) | — | — |

   > **Not shown on the token screen, but you already have it:** your public
   > URL prefix (`https://pub-abc123.r2.dev` or `https://cdn.yourdomain.com`).
   > That goes into `PUBLIC_IMAGE_BASE`.

### 3b.4 — Fill in the .env file

Open `infra/.env` and set these five values. Each one is explained:

```
# Tells the code "use R2" instead of local disk storage.
IMAGE_BACKEND=s3

# The S3-compatible API endpoint. This is the address the code talks to when
# uploading. NOT the public URL — this is a private admin endpoint that needs
# the token to do anything. Copy from the token-creation screen.
S3_ENDPOINT=https://abc123def456.r2.cloudflarestorage.com

# The bucket name you chose in step 3b.2. Must match exactly.
S3_BUCKET=threadsflow

# Access Key ID — the "username" half of your API token.
S3_KEY=abc123...

# Secret Access Key — the "password" half. Keep this safe.
S3_SECRET=xyz789...

# The public URL where images are actually served. This is what Meta fetches
# and what shows up in post metadata. No trailing slash.
#   r2.dev style:  PUBLIC_IMAGE_BASE=https://pub-abc123.r2.dev
#   Custom domain: PUBLIC_IMAGE_BASE=https://cdn.yourdomain.com
PUBLIC_IMAGE_BASE=https://cdn.yourdomain.com
```

> **What does "S3-compatible" mean?** Amazon S3 is the dominant cloud storage
> API. Cloudflare R2, Backblaze B2, MinIO, and dozens of others all speak the
> same S3 protocol. The code sends standard S3-style PUT requests, which R2
> understands natively — no SDK, no library, just plain HTTP with a signature.

### 3b.5 — Test the full pipeline

After `docker compose up -d`, upload a product with an image through the KB:

```bash
# Use a real image file (any JPEG or PNG will do)
curl -u "KB_USER:KB_PASSWORD" \
  -F "affiliate_url=https://s.shopee.com.my/xxxx" \
  -F "description=Test product for R2 setup" \
  -F "images=@test.jpg" \
  https://kb.yourdomain.com/api/products
```

The JSON response includes a `product_uid`. Look up the image URL:

```bash
# Replace with the uid from the response above
curl -u "KB_USER:KB_PASSWORD" https://kb.yourdomain.com/api/products \
  | jq '.[0]'
```

Then open the image URL in a **browser incognito window** (this proves it is
truly public and not relying on your Cloudflare login cookies). If the image
loads, R2 is configured correctly.

**If the image does not load (403 or 404):**

| Symptom | Likely cause | Fix |
|---|---|---|
| 403 on the public URL | r2.dev not enabled or custom domain not connected | Cloudflare Dashboard → R2 → bucket → Settings → Public Access |
| Wrong URL (bucket name doubled or missing) | PUBLIC_IMAGE_BASE has wrong format | See the note in 3b.2 about custom domain vs r2.dev URLs |
| 403 on upload (the KB returns error) | S3_KEY / S3_SECRET wrong | Recreate the API token and copy carefully |
| 403 on upload with correct keys | Bucket name mismatch | S3_BUCKET must match exactly, including case |

### 3b.6 — SigV4: what it is and why you do not need to think about it

*(This section is optional. Skip it and come back if you are curious.)*

When the KB service uploads an image to R2, it sends an HTTP PUT request with a
special `Authorization` header. That header looks like:

```
Authorization: AWS4-HMAC-SHA256
  Credential=S3_KEY/20260727/auto/s3/aws4_request,
  SignedHeaders=host;x-amz-content-sha256;x-amz-date,
  Signature=8f3a2b1c...
```

This is **SigV4** (AWS Signature Version 4). It is a cryptographic handshake:

1. The code builds a "string to sign" from the HTTP method (PUT), the file path,
   today's date, and a SHA-256 hash of the image bytes.
2. It uses your `S3_SECRET` as a key to HMAC-sign that string.
3. It sends the signature along with the request.
4. R2 independently computes the same signature using its copy of your secret
   key. If the two signatures match, the request is accepted. If not, 403.

This means:
- **Nobody can upload without your secret key.** The signature proves possession.
- **Nobody can tamper with a request in transit.** Changing the body would
  change its hash, which would change the expected signature.
- **Nobody can replay an old request.** The date is baked into the signature,
  and R2 rejects requests with stale timestamps.

**The path-encoding bug (already fixed in this repo):** a subtle issue existed
where the code used `new URL().pathname` to get the file path for the signature.
But JavaScript's `URL.pathname` *decodes* percent-encoding — it turns `%20` back
into a space. SigV4 requires the *encoded* path. If a filename contained a
space or any special character, the signature computed from the decoded path
would disagree with the actual URL R2 received, and R2 would return
`403 SignatureDoesNotMatch` — even though the key and secret were correct.

The fix: the code now percent-encodes the path *before* it builds the canonical
request and the URL, so both always agree. You will never see this bug — it was
fixed before you set anything up.

---

## Step 4 — Import workflows

n8n → Import from File → `n8n/workflows/*.json`. Then:
1. Create the **Postgres** credential named `Postgres threadsflow` (host `postgres`, db
   `threadsflow`, schema `public`).
2. Open each Code node and paste in the matching file from `n8n/code/`.
3. Open each LLM HTTP node and point it at your 9router base URL.
4. Activate `wf3_publish` first and smoke-test **both media paths**.

**4a. Text-only post — test this one first.** It needs no CDN, no public bucket, and no image
hosting, so it isolates the Threads API from your storage setup:

```sql
INSERT INTO products (name, affiliate_url, description, media_mode)
VALUES ('Test', 'https://s.shopee.com.my/xxxx',
        'Produk ujian dengan pemegang 11cm dan tahan panas 230 darjah celsius.', 'text');

INSERT INTO posts (uid, product_id, image_ids, media_type, format, angle, tone,
                   sell_intensity, length_band, body, cta_text, tracked_url, scheduled_at)
VALUES ('t' || substr(md5(random()::text),1,5),
        (SELECT id FROM products ORDER BY id DESC LIMIT 1),
        '{}', 'TEXT', 'one_liner', 'utility', 'deadpan', 1, 'mid',
        'Pemegang 11cm tu pendek sikit untuk tangan saya. Tapi tahan 230 darjah dan dah empat bulan okay.',
        'nih https://r.yourdomain.com/p/tXXXXX',
        'https://r.yourdomain.com/p/tXXXXX', now());
```

**4b. Image post** — only after 4a works, since a failure here is almost always image hosting
rather than the API:

```sql
INSERT INTO product_images (product_id, public_url, vision_desc)
VALUES ((SELECT id FROM products ORDER BY id DESC LIMIT 1),
        'https://cdn.yourdomain.com/img/test.jpg', 'test image');

INSERT INTO posts (uid, product_id, image_ids, media_type, format, angle, tone,
                   sell_intensity, length_band, body, cta_text, tracked_url, scheduled_at)
VALUES ('i' || substr(md5(random()::text),1,5),
        (SELECT id FROM products ORDER BY id DESC LIMIT 1),
        ARRAY[(SELECT id FROM product_images ORDER BY id DESC LIMIT 1)],
        'IMAGE', 'one_liner', 'utility', 'deadpan', 1, 'micro',
        'test post dari sistem, pemegang 11cm',
        'nih https://r.yourdomain.com/p/iXXXXX',
        'https://r.yourdomain.com/p/iXXXXX', now());
```

Within 5 minutes each should appear on Threads with a link comment. Click the link on your phone
and confirm a row lands in `clicks`.

> The DB rejects an inconsistent combination (`media_type='IMAGE'` with an empty `image_ids`,
> or `CAROUSEL` with fewer than 2). If your INSERT errors with
> `posts_media_consistency_chk`, that constraint is doing its job — fix the row, don't drop it.

---

## Step 4c — Add your first product (the KB web UI)

Open `https://kb.yourdomain.com/product.html`. Paste the affiliate link, then either:
- drop 1–4 images, **or**
- write a description of at least 80 characters, **or**
- both

The form tells you which mode you are in as you type. Link alone is rejected — with no photo and
no words there is nothing concrete to write from.

The same service at `https://kb.yourdomain.com/` is the Knowledge Base: drag copywriting PDFs
there to expand the technique library. It already ships with **60 techniques** (43 built-in
Malay ones plus 17 mined from your `Books/` folder), so this is entirely optional and can wait
until month two. See `docs/05-books.md` for what came out of your books and what was
deliberately rejected.

---

## Step 5 — Turn on the rest

Activate in this order, one per day, checking output each time:
`wf2_generate` → `wf4_evaluate` → `wf0_token_refresh` → `wf5_conversions` (optional).

There is no `wf1_intake` to activate — product intake is a built-in endpoint of the KB service,
live as soon as `docker compose up` finishes.

For the first week, set `wf2_generate` to write posts with `status='draft'` instead of `'queued'`
and read all 35 of them yourself. **You will find 5–10 phrases that sound like a robot.** Add
them to `banned_phrases` before you let it run unattended. This one hour of reading is worth
more than any prompt engineering.

---

## Step 6 — Weekly operating routine (15 minutes)

| When | What |
|---|---|
| Every 3 days | Read the cycle digest on the dashboard. Don't act on it before cycle 5. |
| Weekly | Read 5 random posts. Add any robotic phrase to `banned_phrases`. |
| Weekly | Add 1–2 new products. Images optional — a link plus a solid description is enough. |
| Weekly | Check `run_log` for errors and `posts WHERE status='failed'`. |
| Every 50 days | Confirm wf0 refreshed the token (`settings.threads_creds.expires_at`). |
| Monthly | Retire CTA variants with `use_count > 8`, add 5 new ones. |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Container creation returns error 9004 | Meta can't fetch `image_url` | Image not public, or behind Access policy. Test with `curl` from outside. **Text-only posts are unaffected — use them to confirm the API works before debugging storage.** |
| All image posts fail, text posts fine | Image hosting, not the API | `PUBLIC_IMAGE_BASE` wrong, or `cdn.` hostname has an Access policy on it |
| R2 upload 403 | Token or path mismatch | Check S3_KEY/S3_SECRET; see the troubleshooting table in Step 3b.5 |
| Post inserted with wrong media_type | `posts_media_consistency_chk` | The constraint is correct; wf2's bandit gate should have prevented it. Check `plan.imageCount` is being passed. |
| Product rejected at intake | No images AND description < 80 chars | Add a description with real specifics, or attach an image |
| Post published but no image | Published before processing finished | Increase the wait from 35s to 60s |
| Every post gets 0 views | Account flagged as spam | Drop to 2 posts/day for a week, raise `sell_intensity=0` share to 40% |
| Clicks logged but no Shopee conversions | SubId not surviving the redirect | Check the final URL after redirect actually contains `sub_id=` |
| Clicks ≫ real traffic | Bot filter too loose | Inspect `SELECT ua, count(*) FROM clicks WHERE NOT is_bot GROUP BY 1` and extend `BOT_UA` |
| n8n OOM-kills | Execution data retention | Confirm `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none` and prune is on |
| Copy is drifting samey again | Model collapse | Add banned phrases, raise `epsilon` to 0.35 for one cycle, add 2 new format levers |
