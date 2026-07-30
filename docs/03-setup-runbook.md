# Setup runbook — from empty VPS to first automated post

This guide assumes **no prior knowledge** of Docker, n8n, Cloudflare, or the
Threads API. Every term is explained the first time it appears. If a step says
"run this command," it means open a terminal (SSH into your VPS) and paste it.

**Total hands-on time:** about a day, most of it waiting for Meta and DNS.

---

## Step 0 — What you need before you start

You need five things ready. Each takes 5–15 minutes to set up.

### 0.1 — A VPS (virtual private server)

A computer in the cloud that runs 24/7. This is where the system lives.

- **Specs:** 4 GB RAM, 2 vCPU, 25+ GB disk, Debian 12 or Ubuntu 22.04
- **Cost:** ~RM 25–45/month (DigitalOcean, Linode, Hetzner, Vultr)
- **Set up:** rent one, note the IP address, SSH into it

### 0.2 — A domain name using Cloudflare DNS

You need a domain like `yourdomain.com` and it must use Cloudflare's DNS
(nameservers). If you bought your domain elsewhere (Namecheap, GoDaddy), you
can still point it to Cloudflare for free.

1. Create a free account at [cloudflare.com](https://cloudflare.com)
2. Add your domain → Cloudflare scans your existing DNS records → import them
3. Cloudflare gives you two nameserver addresses (e.g. `alice.ns.cloudflare.com`)
4. Go to your domain registrar (where you bought the domain) and change the
   nameservers to the ones Cloudflare gave you
5. Wait 5–30 minutes for DNS to propagate

### 0.3 — Docker installed on the VPS

Docker runs programs in isolated "containers" — lightweight boxes that each
have their own filesystem and memory cap. You do not need to understand Docker
internals. You only need it installed.

SSH into your VPS and run:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out and back in for the group change to take effect
```

Verify it works: `docker run hello-world` should print a friendly message.

### 0.4 — AI / LLM endpoint

The system writes posts by calling an OpenAI-compatible API. **9router is the default**, but it is
no longer hard-coded: you can use hosted 9router, a 9router process on your VPS host, OpenAI
directly, OpenRouter, or another compatible proxy.

Default hosted endpoint:

```bash
https://9router.archxry.space/v1
```

Fast local-on-the-same-VPS option:

```bash
# 9router runs on the VPS host, outside Docker, listening on port 9000.
9router serve --port 9000
curl http://localhost:9000/v1/models

# Containers must reach the host through host.docker.internal, not localhost:
LLM_BASE_URL=http://host.docker.internal:9000/v1
```

> **Important Docker note:** `localhost` inside the n8n/kb containers means "this container", not
> the VPS host. If 9router runs outside Docker, use `http://host.docker.internal:9000/v1`.
>
> **Which is faster?** `host.docker.internal` to a VPS-host 9router is usually faster than going
> out to a public HTTPS domain, but hosted 9router is easier and works immediately. Both are still
> proxying to hosted AI models; this project does not run a local LLM.
>
> If you prefer not to use 9router, point the base URL directly at one provider, for example
> `https://api.openai.com/v1`, and set that provider's API key and model names.

### 0.5 — A Cloudflare Tunnel token

Cloudflare Tunnel creates a secure pipe from your VPS to Cloudflare's network.
It lets people reach your server through Cloudflare's infrastructure without
you opening any ports on your firewall. You also get free HTTPS automatically.

1. Cloudflare Dashboard → **Zero Trust** (left sidebar)
2. **Networks** → **Tunnels** → **Create a tunnel**
3. Name it `threadsflow`, click **Save**
4. You will see an install command. You do NOT need to run it (Docker handles
   this). Instead, copy the **token** from the command — it is the long string
   after `--token`.
   The command looks like:
   ```
   cloudflared tunnel run --token eyJh...longstring...
   ```
   Copy `eyJh...longstring...`. This is your `CF_TUNNEL_TOKEN`.

5. Paste it into `infra/.env` later (Step 2).

---

## Step 1 — Threads API access (do this FIRST, it gates everything)

You need a **token** — a long password string from Meta. The system sends this
token with every request to prove it is allowed to post to your account.

You do **not** need App Review because you are posting to your own account.
You use the "Threads Tester" shortcut instead.

### 1.1 — Create a Meta app

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Click **Create App** (top right)
3. Choose use case: **"Access the Threads API"**
4. Give it a name (anything, e.g. "My Threads Poster")
5. Click **Create App**

### 1.2 — Add permissions

Inside your new app, go to **App settings → Use cases** or **Add products**:

- Add **Threads** if it is not already there
- Under Threads, request these permissions:
  - `threads_basic` — lets the system read basic profile info
  - `threads_content_publish` — lets it create posts
  - `threads_manage_insights` — lets it read post statistics (views, likes)
  - `threads_manage_replies` — lets it post the link comment

### 1.3 — The Threads Tester shortcut (do not skip this)

1. In your Meta app → **App roles** → **Roles**
2. Click **Add People** → **Threads Tester**
3. Enter your own Threads username (the one you use on threads.net)
4. Click **Add**
5. Now go to **threads.net** → **Settings** → **Website permissions** → **Invites**
6. Accept the invite

This step lets you skip Meta's full App Review, which takes weeks and may be
rejected. As a Threads Tester, you can post to your own account indefinitely
with no review.

> **Everyone misses step 5.** Without accepting the invite, every API call
> returns an OAuth error saying you do not have permission. Check this first
> if anything fails.

### 1.4 — Get the token

1. In your Meta app → **Threads** → **API Setup**
2. Set a redirect URI: use `https://localhost/` for now (you only do this once)
3. Generate a **short-lived token** (valid for 1 hour)
4. Exchange it for a **long-lived token** (valid for 60 days):

```bash
# Copy-paste this into your terminal. Replace the UPPERCASE values.
curl -s "https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=YOUR_APP_SECRET&access_token=YOUR_SHORT_LIVED_TOKEN"
```

The response contains `access_token`. This is your long-lived token. Write it
down — you will paste it into the database in Step 2.

5. Find your Threads user ID:

```bash
curl -s "https://graph.threads.net/v1.0/me?fields=id,username&access_token=YOUR_LONG_TOKEN"
```

The response contains `id` (a long number). Write this down too.

### 1.5 — Smoke test (do not skip this)

Before you build anything else, make sure the token actually works. Copy-paste
this, replacing the UPPERCASE values:

```bash
TOKEN="your long token here"
UID="your user id number here"

# Step 1: create a post container
CID=$(curl -s -X POST "https://graph.threads.net/v1.0/$UID/threads" \
  -d "media_type=IMAGE" \
  -d "image_url=https://picsum.photos/1080" \
  -d "text=ujian sistem — post ini akan dipadam" \
  -d "access_token=$TOKEN" | jq -r .id)

echo "Container ID: $CID"

# Step 2: wait 35 seconds (Threads needs time to process the image)
sleep 35

# Step 3: publish
curl -s -X POST "https://graph.threads.net/v1.0/$UID/threads_publish" \
  -d "creation_id=$CID" \
  -d "access_token=$TOKEN"
```

If a post appears on your Threads profile, the hard part is done. **Delete the
test post** afterwards. If the post does NOT appear, stop here and debug —
no amount of n8n setup will fix a broken token.

> **"jq: command not found"?** Install it: `sudo apt install jq -y`

---

## Step 2 — Clone the repo and bring up the stack

### 2.1 — Clone the project

```bash
git clone https://github.com/SuperDuperNoob/threadsflow_arena.AI.git ~/threadsflow
cd ~/threadsflow/infra
```

### 2.2 — Create your .env file

```bash
cp .env.example .env
```

Now generate random passwords. Run these one at a time and paste the output
into your `.env` file:

```bash
openssl rand -hex 32    # → paste this as N8N_ENCRYPTION_KEY
openssl rand -hex 16    # → paste this as IP_SALT
openssl rand -base64 24 # → paste this as PG_PASSWORD
```

Edit the `.env` file:

```bash
nano .env
```

Fill in every value. Here is what each one means:

```
# The password for your PostgreSQL database. Use the random output from above.
PG_PASSWORD=r4Nd0mStR1nG...

# The domain where you will access the n8n dashboard.
# Replace "yourdomain.com" with your actual domain.
N8N_HOST=n8n.yourdomain.com

# A random 64-character hex string. Use the openssl output from above.
N8N_ENCRYPTION_KEY=...

# The username and password you will use to log into n8n.
N8N_USER=admin
N8N_PASSWORD=pick_a_secure_password

# Password for the Knowledge Base web UI (product upload + PDF upload).
KB_PASSWORD=pick_a_secure_password

# ═══ AI / LLM settings ═══
# Default hosted 9router. You can change this later in KB → LLM Settings.
LLM_BASE_URL=https://9router.archxry.space/v1
LLM_API_KEY=
LLM_MODEL_WRITE=gemini-2.5-flash
LLM_MODEL_EDIT=gpt-4.1-mini
LLM_MODEL_MINE=gemini-2.5-pro
LLM_MODEL_EMBED=text-embedding-3-small

# Faster if 9router runs on the VPS host outside Docker:
# LLM_BASE_URL=http://host.docker.internal:9000/v1
# Do not use http://localhost:9000 from inside Docker containers.

# ═══ Image hosting ═══
# See Step 3b for detailed R2 setup instructions.
IMAGE_BACKEND=s3
S3_ENDPOINT=https://YOURACCOUNTID.r2.cloudflarestorage.com
S3_BUCKET=threadsflow
S3_KEY=your_access_key_id
S3_SECRET=your_secret_access_key
PUBLIC_IMAGE_BASE=https://cdn.yourdomain.com

# ═══ Redirector ═══
# Public URL for the redirector. CTA comments use this to create links like /p/<post_uid>.
PUBLIC_REDIRECT_BASE=https://r.yourdomain.com
# A random salt used to hash IP addresses (for privacy).
# Use the openssl output from above.
IP_SALT=...

# ═══ Cloudflare Tunnel ═══
# The token you copied in Step 0.5.
CF_TUNNEL_TOKEN=eyJh...

# ═══ You will set these later, after creating the R2 bucket ═══
# Leave blank for now if you have not done Step 3b yet.
```

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`).

### 2.3 — Start the containers

```bash
docker compose up -d
```

This starts three containers and one tunnel:

- **postgres** — the database (stores products, posts, clicks, scores)
- **n8n** — the automation engine (you will open this in your browser)
- **redirector** — the link shortener + click tracker
- **kb** — the Knowledge Base service (product upload form, PDF upload)
- **cloudflared** — the Cloudflare Tunnel daemon

Wait 30 seconds for everything to start, then check:

```bash
docker compose ps
```

All services should show `Up` or `running`. If any show `Exited` or
`Restarting`, check the logs:

```bash
docker compose logs postgres
docker compose logs cloudflared
```

### 2.4 — Set up the database

The database starts empty. You need to create the tables, run migrations, and fill them with initial seeds.

Instead of running multiple sql scripts manually, we have provided an automated database initialization script. Run this single command from the repository root:

```bash
./scripts/init_db.sh
```

This script automatically executes all schemas, seeds, and **all 9 migrations** in the correct numerical order:
1. **Core schemas** (`schema.sql`, `schema_techniques.sql`, `schema_kb.sql`)
2. **Seeds** (`seed_levers_my.sql`, `seed_techniques_my.sql`, `mining_questions.sql`)
3. **Migrations 001 through 009** (adding compatible media, localizations, contextual bandit weights, reply loops, user comment intent definitions, shared LLM config, and redirect base URL config)
4. **Books techniques seed** (`seed_techniques_books.sql`)
5. **LLM config sync** from `infra/.env` into `settings.llm`

> **What does each file do?** Think of `schema.sql` as creating empty tables (like empty Excel sheets). The `seed_*.sql` files fill those tables with starting data — the levers (writing styles), the techniques (copywriting patterns), and the banned phrases. The migrations make updates and add improvements over time.

### 2.5 — Store your Threads token in the database

The workflows read secrets from the database, not from the `.env` file. This
lets wf0 (the token refresh workflow) update the token automatically.

Log into the database interactively:

```bash
docker compose exec postgres psql -U threadsflow -d threadsflow
```

Then paste this, replacing the placeholder values:

```sql
-- Your Threads API token and user ID from Step 1.4
INSERT INTO settings (key, value) VALUES
('threads_creds', '{"token":"YOUR_LONG_TOKEN","user_id":"YOUR_USER_ID","expires_at":"2026-09-25"}');

-- LLM settings: where to send OpenAI-compatible AI calls.
-- You can also edit this later at https://kb.yourdomain.com/settings.html.
INSERT INTO settings (key, value) VALUES
('llm', '{"base_url":"https://9router.archxry.space/v1",
          "api_key":"",
          "model_write":"gemini-2.5-flash",
          "model_edit":"gpt-4.1-mini",
          "model_embed":"text-embedding-3-small",
          "model_mine":"gemini-2.5-pro"}');
-- If 9router runs on the VPS host outside Docker, use:
--   "base_url":"http://host.docker.internal:9000/v1"

-- Shopee Affiliate Open API: used by wf5 (conversion sync) and by product intake
-- (authoritative price/commission). Get the App ID + API Key from the affiliate
-- dashboard → Open API section: https://affiliate.shopee.com.my/dashboard
-- Env vars (SHOPEE_API_APP_ID / SHOPEE_API_SECRET) also work and are simpler — set
-- those in your .env and you can skip these two rows.
INSERT INTO settings (key, value) VALUES
('shopee_app_id', '{"v":"YOUR_SHOPEE_APP_ID"}'),
('shopee_app_secret', '{"v":"YOUR_SHOPEE_API_SECRET"}');

-- Optional: pull the last 7 days of Shopee conversions into Postgres (wf5):
--   DATABASE_URL=... SHOPEE_API_APP_ID=... SHOPEE_API_SECRET=... \
--     node services/kb/bin/shopee.mjs sync

-- Next cycle plan: starts empty, filled by the learning loop
INSERT INTO settings (key, value) VALUES
('next_cycle_plan', '[]');

-- Type \q to exit psql
\q
```

> **Changing LLM later:** open `https://kb.yourdomain.com/settings.html` and edit Base URL,
> API key, and models from the browser. Or run:
>
> ```bash
> ./scripts/configure_llm.sh --base-url https://api.openai.com/v1 --api-key sk-... \
>   --write-model gpt-4.1-mini --edit-model gpt-4.1-mini \
>   --embed-model text-embedding-3-small --mine-model gpt-4.1
> ```
>
> **How do these settings get used?** Each n8n workflow has a "Postgres" node
> that reads from the `settings` table. When wf3_publish needs the token to
> post, it queries `SELECT value FROM settings WHERE key='threads_creds'`,
> pulls the token out of the JSON, and sends it to the Threads API. You never
> type the token into a workflow directly.

---

## Step 3 — Cloudflare Tunnel hostnames

Cloudflare Tunnel is already running (the `cloudflared` container started with
docker compose). Now you need to tell Cloudflare which web addresses should
point to which services on your VPS.

### 3.1 — What you are doing

Your VPS has several services running inside Docker, each on a different port:

| Service | Internal address | Port | What it does |
|---|---|---|---|
| n8n | `http://n8n:5678` | 5678 | Automation dashboard |
| KB | `http://kb:8082` | 8082 | Product upload + PDF upload |
| Redirector | `http://redirector:8081` | 8081 | Link shortener + click tracking |

Cloudflare Tunnel makes these available on the internet through your domain.
You create "public hostnames" — rules that say "when someone visits
`n8n.yourdomain.com`, send them to `http://n8n:5678` inside Docker."

### 3.2 — Create the hostnames

1. Cloudflare Dashboard → **Zero Trust** → **Networks** → **Tunnels**
2. Click your `threadsflow` tunnel
3. **Public Hostnames** tab → **Add a public hostname**

Create these four entries, one at a time:

| Hostname | Service | Access policy | Why |
|---|---|---|---|
| `n8n.yourdomain.com` | `http://n8n:5678` | **Require your email** | Your automation dashboard. Lock it. |
| `kb.yourdomain.com` | `http://kb:8082` | **Require your email** | Product upload form. Lock it. |
| `r.yourdomain.com` | `http://redirector:8081` | **None** | Link in post comments. Must be public so buyers can click it. |
| `cdn.yourdomain.com` | `http://kb:8082` | **None** | Only needed if IMAGE_BACKEND=local. With R2, images are served from Cloudflare's CDN directly — skip this hostname. |

> **"Access policy"** is Cloudflare's gatekeeper. If you set it to "Require
> your email," anyone who visits that address must log in with the email
> address on your Cloudflare account. If you set it to "None," anyone on the
> internet can reach it.
>
> **Do NOT lock `r.` or `cdn.`** — locking `r.` means buyers see a login page
> instead of Shopee. Locking `cdn.` means Meta's servers cannot fetch your
> images and every image post fails with error 9004.

### 3.3 — Verify

```bash
# The redirector should return 200 (healthy) on /healthz
curl -I https://r.yourdomain.com/healthz

# And a 302 (redirect) on any /p/ path
curl -I https://r.yourdomain.com/p/testuid

# The KB should return 200 on /healthz
curl -I https://kb.yourdomain.com/healthz
```

If these return errors, wait 2 minutes (DNS can be slow) and try again.

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

Open `infra/.env` (you created this in Step 2.2) and set these five values.
If the system is already running, restart it after changing the .env:

```bash
docker compose up -d
```

Each value explained:

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

Upload a product with an image through the KB:
```bash
# First, log in to get a session cookie
curl -c /tmp/kb_cookies.txt -X POST https://kb.yourdomain.com/api/login \
  -H "Content-Type: application/json" \
  -d '{"password":"YOUR_KB_PASSWORD"}'

# Upload a product with an image (any JPEG or PNG will do)
curl -b /tmp/kb_cookies.txt \
  -F "affiliate_url=https://s.shopee.com.my/xxxx" \
  -F "product_url=https://shopee.com.my/product/43768/18938427295" \
  -F "description=Test product for R2 setup" \
  -F "images=@test.jpg" \
  https://kb.yourdomain.com/api/products
```

The JSON response includes a `product_uid`. Look up the image URL:

```bash
curl -b /tmp/kb_cookies.txt https://kb.yourdomain.com/api/products | jq '.[0]'
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

## Step 4 — Import workflows into n8n

n8n is the automation engine. You open it in your browser at
`https://n8n.yourdomain.com`. It looks like a flowchart canvas — you drag boxes
and connect them with lines. Each box is a "node" that does one thing:
call an API, query the database, run some code, wait for a timer.

The project comes with pre-built workflow templates (JSON files). You import
them, fill in a few blanks, and activate them.

### 4.1 — Open n8n and create credentials

1. Open `https://n8n.yourdomain.com` in your browser
2. Log in with the username and password you set in `.env` (N8N_USER / N8N_PASSWORD)

**Create the Postgres connection:** n8n needs to know how to talk to your
database. In the left sidebar:

1. Click **Credentials** (the key icon)
2. Click **Add Credential**
3. Search for "Postgres" → select **Postgres**
4. Fill in:
   - **Host**: `postgres` (this is the Docker service name; n8n is in the same Docker network)
   - **Database**: `threadsflow`
   - **User**: `threadsflow`
   - **Password**: (your PG_PASSWORD from .env)
   - **Port**: `5432` (keep the default)
   - **SSH Tunnel**: leave off
   - **Name** (top of the form): `Postgres threadsflow`
5. Click **Save**

You only do this once. All four workflows share this credential.

### 4.2 — Import the workflows

Each workflow is a JSON file in `n8n/workflows/`. Import them one at a time:

1. n8n top-right → **...** menu → **Import from File**
2. Select a workflow file from `n8n/workflows/`
3. After import, the workflow appears as a new tab
4. **Important:** imported workflows start **deactivated** (the toggle is off).
   This is correct — do not activate anything yet.

Import these in order:

| File | What it does | Ready to use? |
|---|---|---|
| `wf0_token_refresh.json` | Renews the Threads API token every 25 days | Yes, just set the credential |
| `wf3_publish.json` | Publishes queued posts to Threads every 5 min | Yes |
| `wf2_generate.json` | Writes 5 posts nightly at 3 AM | Yes — pre-populated with code blocks |
| `wf4_evaluate.json` | Scores posts and updates the bandit every 3 days | Yes — pre-populated with code blocks |

> **What is a "workflow"?** It is a recipe. wf3_publish says: "Every 5 minutes,
> check the database for posts that are queued and due. If there is one, post
> it to Threads, wait, then post the link comment." The n8n canvas shows this
> as a chain of boxes: Cron → Postgres → HTTP Request → Wait → HTTP Request.

### 4.3 — Code blocks are pre-populated!

**Good news:** the workflow JSON files in `n8n/workflows/` are **already pre-populated** with the corresponding Javascript code blocks out of the box! You can skip this step entirely and proceed to §4.4.

However, if you ever customize the logic inside the `n8n/code/` folder and want to re-inject your changes into the workflow templates, you can run:
```bash
node scripts/populate_workflows.js
```
Or you can manually copy and paste the contents into the respective n8n **Code** nodes:

| Workflow | Code node | Paste from |
|---|---|---|
| wf2_generate | Build slot plan | `n8n/code/slot_plan.js` |
| wf2_generate | Bandit: pick arm | `n8n/code/bandit.js` |
| wf2_generate | Pick devices | `n8n/code/technique_picker.js` |
| wf2_generate | QA gate | `n8n/code/qa.js` |
| wf4_evaluate | Flatten metrics | `n8n/code/scoring.js` |
| wf4_evaluate | Score cycle | `n8n/code/scoring.js` |
| wf4_evaluate | Update arms + plan | `n8n/code/bandit.js` |
| wf4_evaluate | Update techniques | `n8n/code/technique_picker.js` |

> **For technique_picker**, the same file is pasted into both workflows but
> with different modes: `select` in wf2_generate (picks which techniques to use
> for this post) and `update` in wf4_evaluate (scores past technique usage).

5. Click outside the node to save. n8n auto-saves.

> **Why are these separate files?** Keeping the JS logic as separate `.js`
> files in the repository means you can read, unit-test, and update the logic
> in a proper editor. The `populate_workflows.js` script handles embedding them
> into the workflow JSON templates for direct n8n import.

### 4.4 — Confirm the LLM HTTP nodes use shared config

wf2_generate has HTTP Request nodes that call the AI to write, edit and embed. In the imported
workflow templates these nodes already use expressions like:

```text
{{ $json.cfg.llm.base_url }}/chat/completions
{{ $json.cfg.llm.base_url }}/embeddings
Authorization: Bearer {{ $json.cfg.llm.api_key }}
```

So you normally do **not** edit the HTTP nodes one by one. Change the endpoint in one place:

- Browser: `https://kb.yourdomain.com/settings.html`
- CLI: `./scripts/configure_llm.sh --local-9router` or `./scripts/configure_llm.sh --base-url ...`
- SQL: update the `settings` row where `key='llm'`

If you imported an older workflow, re-import `n8n/workflows/wf2_generate.json` or manually change
its LLM HTTP nodes to read from `cfg.llm` instead of hard-coded URLs.

### 4.5 — Assign credentials to each workflow

For every **Postgres** node in every workflow:
1. Double-click the node
2. Under **Credential to connect with**, select `Postgres threadsflow`
3. Click outside to save

Each workflow has multiple Postgres nodes. Go through them all.

---

## Step 5 — First smoke tests

### 5.1 — Test wf3_publish (the posting workflow)

**Activate** wf3_publish: click the toggle switch in the top-right of the
workflow. It turns green.

Every 5 minutes, wf3 checks the database for posts with `status='queued'` that
are due. Since there are none yet, it will do nothing — this is correct.

Now insert a test text post manually. Open a database shell:

```bash
docker compose exec postgres psql -U threadsflow -d threadsflow
```

Paste this. It creates a product and a queued post:

```sql
-- Create a test product. media_mode='text' means no images needed.
-- product_url is optional and used only for enrichment; buyer clicks still use affiliate_url.
INSERT INTO products (name, affiliate_url, product_url, description, media_mode)
VALUES ('Test', 'https://s.shopee.com.my/xxxx', 'https://shopee.com.my/product/43768/18938427295',
        'Produk ujian dengan pemegang 11cm dan tahan panas 230 darjah celsius.', 'text');

-- Create a queued post. scheduled_at = now() means "publish immediately."
INSERT INTO posts (uid, product_id, image_ids, media_type, format, angle, tone,
                   sell_intensity, length_band, body, cta_text, tracked_url, scheduled_at)
VALUES ('t' || substr(md5(random()::text),1,5),
        (SELECT id FROM products ORDER BY id DESC LIMIT 1),
        '{}', 'TEXT', 'one_liner', 'utility', 'deadpan', 1, 'mid',
        'Pemegang 11cm tu pendek sikit untuk tangan saya. Tapi tahan 230 darjah dan dah empat bulan okay.',
        'nih https://r.yourdomain.com/p/tXXXXX',
        'https://r.yourdomain.com/p/tXXXXX', now());
\q
```

Within 5 minutes, wf3_publish picks up this post and publishes it. Check your
Threads profile. If you see the post with a link comment, it works.

> **Delete the test post from Threads** after confirming it works.

### 5.2 — Test an image post (only if R2 is configured)

If you completed Step 3b (R2 setup), test an image post:

```sql
-- Insert a test image record
INSERT INTO product_images (product_id, public_url, vision_desc)
VALUES ((SELECT id FROM products ORDER BY id DESC LIMIT 1),
        'https://cdn.yourdomain.com/test.jpg', 'test image');

-- Insert a queued IMAGE post
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

Check your Threads profile. If the image post appears, R2 is fully working.

> **If it fails:** the #1 cause is Meta cannot fetch the image URL. Open the
> `public_url` in an incognito browser window. If it does not load, go back
> to Step 3b.5 and check the R2 setup.

---

## Step 6 — The KB web UI (product intake)

The KB service has two web pages, both at `https://kb.yourdomain.com`:

| Page | URL | What it does |
|---|---|---|
| Product intake | `https://kb.yourdomain.com/product.html` | Add products with images and/or description |
| Knowledge Base | `https://kb.yourdomain.com/` | Upload copywriting PDFs to grow the technique library |

Open the product page. You will go through two login steps: first Cloudflare
Access (if you set the email policy on kb.yourdomain.com), then the KB's own
login form using your KB_PASSWORD. After that, paste your Shopee affiliate link
(the money link). If you also have the normal full product page, paste it into
`Full Shopee product URL` — it is optional and used only to help enrichment find
the item ID. Then either drop 1–4 images OR write a description of at least 80
characters (or both). The form tells you which mode you are in as you type.

> **Affiliate link alone is rejected.** With no photo and no words, the AI has
> nothing real to write from. You will see a message explaining what to add.

The Knowledge Base at the same domain is optional. It already ships with **60
techniques** (43 built-in Malay ones + 17 from your Books/ folder), so
uploading PDFs can wait until month two.

---

## Step 7 — Activate the remaining workflows

Activate these in order, one per day, checking output each time:

| Order | Workflow | What to check |
|---|---|---|
| 1 | `wf3_publish` | Test posts from Step 5 appeared on Threads |
| 2 | `wf2_generate` | Check the n8n execution history. 5 posts should be created with status='queued' each night |
| 3 | `wf4_evaluate` | After 3 days, check the `cycles` table for a digest row |
| 4 | `wf0_token_refresh` | Check `settings.threads_creds.expires_at` refreshes every 25 days |

> **"Activate"** means clicking the toggle in the top-right of the workflow
> canvas so it turns green. An active workflow runs on its schedule. An
> inactive workflow sits there doing nothing.

There is no `wf1_intake` to activate — product intake is a built-in endpoint
of the KB service, live as soon as `docker compose up` finishes.

**For the first week,** set wf2_generate to write posts with `status='draft'`
instead of `'queued'`. Open the workflow, find the Insert node (the one that
writes `INSERT INTO posts`), change `'queued'` to `'draft'`. This way the
posts are created but wf3 skips them — you can read them in the database
before anything goes live.

Read all 35 drafts. **You will find 5–10 phrases that sound like a robot.**
Add them to the banned list:

```sql
docker compose exec postgres psql -U threadsflow -d threadsflow
INSERT INTO banned_phrases (pattern, reason, scope)
VALUES ('phrase yang bunyi pelik', 'sounds like AI wrote it', 'all');
\q
```

This one hour of reading is worth more than any prompt engineering.

---

## Step 7b — First public deployment: 72-hour canary (recommended)

For the first three days live, run the stack in **canary mode**: extra structured
logging (with secret masking baked in) plus an observer script that snapshots stack
health every 5 minutes. Full instructions, pass/fail criteria and cleanup:
**[docs/08-72h-canary.md](08-72h-canary.md)**.

> **Canary mode is LIVE, not a mock.** It only adds logging — wf2/wf3 publish real
> posts to Threads with real affiliate links throughout. If you want a no-publish
> dry-run first, use the `'draft'` trick from Step 7 above, review the drafts for a
> day or two, then flip back to `'queued'` and start the 72-hour canary clock.

The short version:

```bash
# infra/.env — turn on debug logging with a built-in expiry
DEBUG_MODE=true
DEBUG_UNTIL=<3 days from now, ISO — e.g. $(date -u -d '+3 days' +%Y-%m-%dT%H:%M:%SZ)>
LOG_LEVEL=debug
```

```bash
cd infra && docker compose up -d      # pick up the new env
cd .. && ./scripts/observe_72h.sh     # writes snapshots to logs/observe_72h.log
```

After 72 hours (debug logging expires by itself once `DEBUG_UNTIL` passes), set
`DEBUG_MODE=false`, `LOG_LEVEL=info`, and `docker compose up -d` again.

---

## Step 8 — Weekly operating routine (15 minutes)

| When | What |
|---|---|
| Every 3 days | Read the cycle digest. Do not act on it before cycle 5. |
| Weekly | Read 5 random posts. Add any robotic phrase to `banned_phrases`. |
| Weekly | Add 1–2 new products. Images optional — a link plus a solid description is enough. |
| Weekly | Check for errors: `docker compose exec postgres psql -U threadsflow -d threadsflow -c "SELECT * FROM run_log WHERE level='error' ORDER BY ts DESC LIMIT 10"` |
| Monthly | Check that the Meta token is being renewed: `docker compose exec postgres psql -U threadsflow -d threadsflow -c "SELECT value->>'expires_at' FROM settings WHERE key='threads_creds'"` |
| Monthly | Retire overused CTA variants, add 5 new ones |

---

## Troubleshooting

| Symptom | What it means | What to do |
|---|---|---|
| `docker compose up` fails with port already in use | Something else is using port 5432 or 5678 | `sudo lsof -i :5432` to find it. Stop it or change the port. |
| n8n web UI shows "not found" or 502 | Tunnel not connected or n8n still starting | `docker compose logs cloudflared` and `docker compose logs n8n`. Wait 60 seconds. |
| Container creation returns error 9004 | Meta cannot fetch your `image_url` | Image not public. Test the URL in an incognito browser. Text-only posts are unaffected. |
| All image posts fail, text posts fine | Image hosting | Check `PUBLIC_IMAGE_BASE` is correct and the R2 bucket has public access enabled. |
| R2 upload returns 403 | Token or path mismatch | Check S3_KEY/S3_SECRET; see the R2 troubleshooting table in Step 3b.5. |
| Product rejected at intake with "description too short" | No images AND description < 80 chars | Add a description with real specifics, or attach an image. |
| Post published but no image appears | Published before Threads finished processing the image | Increase the wait from 35s to 60s in wf3_publish. |
| Every post gets 0 views | Account flagged as spam | Drop to 2 posts/day for a week, raise sell_intensity=0 share to 40%. |
| n8n crashes with "out of memory" | The VPS ran out of RAM | Confirm `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none` in the n8n environment. If still crashing, upgrade to 8GB VPS. |
| Copy sounds the same across posts | The LLM is collapsing into a pattern | Add banned phrases, raise the exploration rate to 0.35 for one cycle, add 2 new format levers. |
| Token renewal failed (wf0 shows error) | The Threads token is expired or the app secret changed | Generate a new token manually (Step 1.4) and update the `settings` table. Add an alert to wf0's failure branch. |
