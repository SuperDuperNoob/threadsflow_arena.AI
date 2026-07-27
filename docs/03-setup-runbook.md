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
docker compose exec -T postgres psql -U threadsflow -d threadsflow < ../db/schema.sql
docker compose exec -T postgres psql -U threadsflow -d threadsflow < ../db/seed_levers.sql
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
| `app.yourdomain.com` | `http://ui:8080` | **Require your email** |
| `r.yourdomain.com` | `http://redirector:8081` | **None — must be public** |
| `cdn.yourdomain.com` | `http://minio:9000` | **None — Meta must fetch images** |

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
4. Activate `wf3_publish` first, with one manually-inserted test row:

```sql
INSERT INTO products (name, affiliate_url, notes)
VALUES ('Test', 'https://s.shopee.co.id/xxxx', 'test');
INSERT INTO product_images (product_id, public_url, vision_desc)
VALUES (1, 'https://cdn.yourdomain.com/threadsflow/test.jpg', 'test image');
INSERT INTO posts (uid, product_id, image_ids, format, angle, tone, sell_intensity,
                   length_band, body, cta_text, tracked_url, scheduled_at)
VALUES ('t' || substr(md5(random()::text),1,5), 1, ARRAY[1], 'one_liner','utility','deadpan',
        1, 'micro', 'test post dari sistem', 'nih https://r.yourdomain.com/p/tXXXXX',
        'https://r.yourdomain.com/p/tXXXXX', now());
```

Within 5 minutes it should appear on Threads with a link comment. Click the link on your phone
and confirm a row lands in `clicks`.

---

## Step 5 — Turn on the rest

Activate in this order, one per day, checking output each time:
`wf1_intake` → `wf2_generate` → `wf4_evaluate` → `wf5_conversions` → `wf0_token_refresh`.

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
| Weekly | Add 1–2 new products (2–4 images each). The bandit needs variety to stay useful. |
| Weekly | Check `run_log` for errors and `posts WHERE status='failed'`. |
| Every 50 days | Confirm wf0 refreshed the token (`settings.threads_creds.expires_at`). |
| Monthly | Retire CTA variants with `use_count > 8`, add 5 new ones. |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Container creation returns error 9004 | Meta can't fetch `image_url` | Image not public, or behind Access policy. Test with `curl` from outside. |
| Post published but no image | Published before processing finished | Increase the wait from 35s to 60s |
| Every post gets 0 views | Account flagged as spam | Drop to 2 posts/day for a week, raise `sell_intensity=0` share to 40% |
| Clicks logged but no Shopee conversions | SubId not surviving the redirect | Check the final URL after redirect actually contains `sub_id=` |
| Clicks ≫ real traffic | Bot filter too loose | Inspect `SELECT ua, count(*) FROM clicks WHERE NOT is_bot GROUP BY 1` and extend `BOT_UA` |
| n8n OOM-kills | Execution data retention | Confirm `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none` and prune is on |
| Copy is drifting samey again | Model collapse | Add banned phrases, raise `epsilon` to 0.35 for one cycle, add 2 new format levers |
