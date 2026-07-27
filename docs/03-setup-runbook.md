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

# migrations — safe to run twice, run both on a fresh install too
for m in 001_optional_media.sql 002_localisation.sql; do
  docker compose exec -T postgres psql -U threadsflow -d threadsflow < ../db/migrations/$m
done
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

**MinIO public bucket:**
```bash
docker compose exec minio mc alias set local http://localhost:9000 $MINIO_USER $MINIO_PASSWORD
docker compose exec minio mc mb local/threadsflow
docker compose exec minio mc anonymous set download local/threadsflow
```
Then confirm from *outside your network* that `https://cdn.yourdomain.com/threadsflow/test.jpg`
loads. If Meta can't fetch it, container creation fails with a useless error.

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
there to expand the technique library. It ships with 42 built-in techniques, so this is entirely
optional and can wait until month two.

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
| Post inserted with wrong media_type | `posts_media_consistency_chk` | The constraint is correct; wf2's bandit gate should have prevented it. Check `plan.imageCount` is being passed. |
| Product rejected at intake | No images AND description < 80 chars | Add a description with real specifics, or attach an image |
| Post published but no image | Published before processing finished | Increase the wait from 35s to 60s |
| Every post gets 0 views | Account flagged as spam | Drop to 2 posts/day for a week, raise `sell_intensity=0` share to 40% |
| Clicks logged but no Shopee conversions | SubId not surviving the redirect | Check the final URL after redirect actually contains `sub_id=` |
| Clicks ≫ real traffic | Bot filter too loose | Inspect `SELECT ua, count(*) FROM clicks WHERE NOT is_bot GROUP BY 1` and extend `BOT_UA` |
| n8n OOM-kills | Execution data retention | Confirm `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none` and prune is on |
| Copy is drifting samey again | Model collapse | Add banned phrases, raise `epsilon` to 0.35 for one cycle, add 2 new format levers |
