# ThreadsFlow Quick Start Guide

> Get ThreadsFlow running in under 10 minutes with one-click setup scripts.

---

## Scenario A: New VPS (Fresh Installation)

**Requirements:** Fresh Debian 11+ or Ubuntu 20.04+ VPS (2 vCPU, 4GB RAM minimum)

### One-Click Setup

```bash
# SSH into your VPS as root
ssh root@your-vps-ip

# Download and run the setup script
curl -sSL https://raw.githubusercontent.com/SuperDuperNoob/threadsflow_arena.AI/main/scripts/setup_new_vps.sh | bash
```

**OR** if you prefer to clone first:

```bash
git clone https://github.com/SuperDuperNoob/threadsflow_arena.AI.git
cd threadsflow_arena.AI
sudo ./scripts/setup_new_vps.sh
```

### What the script does:
1. ✅ Installs Docker and Docker Compose
2. ✅ Clones the repository
3. ✅ Generates secure random passwords
4. ✅ Creates `.env` configuration
5. ✅ Starts all Docker services
6. ✅ Runs all current database migrations (`001` through `020`)
7. ✅ Seeds 93+ techniques, levers, and 177 Malaysian snippets
8. ✅ Configures LLM settings

### After Setup (5 minutes)

1. **Edit `infra/.env`** to add your credentials:
   ```bash
   nano infra/.env
   ```
   
   Required:
   - `N8N_HOST=n8n.yourdomain.com` (your n8n subdomain)
   - `LLM_API_KEY=sk-...` (your LLM API key)
   - `CF_TUNNEL_TOKEN=eyJh...` (from Cloudflare Zero Trust)
   - `S3_KEY` and `S3_SECRET` (from Cloudflare R2)
   - `PUBLIC_REDIRECT_BASE=https://r.yourdomain.com`

2. **Restart services:**
   ```bash
   cd infra && docker compose up -d
   ```

3. **Add your Threads token** — use the helper, which validates the token
   against the Threads API before storing it and also writes the copy that
   `wf7_l4_reply` reads:
   ```bash
   ./scripts/set_secrets.sh --threads-token 'THQVJ...' --threads-user-id '178414...'
   ./scripts/set_secrets.sh --show     # confirm what is stored (masked)
   ```
   Getting the token itself is a one-time manual step (Meta OAuth + Threads
   Tester invite) — see `./scripts/set_secrets.sh --help` for the exact flow,
   and `docs/14-agent-autonomous-deploy.md` for why it cannot be automated.

4. **Access n8n dashboard & review queue:**
   - n8n dashboard: `https://n8n.yourdomain.com` (Password in `infra/.env` under `N8N_PASSWORD`)
   - **Human Review Queue:** `https://kb.yourdomain.com/queue.html` (Approve, reject, or edit generated posts before publication; log in with `KB_PASSWORD`)

5. **Import workflows** — `setup_new_vps.sh` already ran this via
   `scripts/bootstrap_n8n.sh`, which creates the n8n owner account, imports the
   Postgres credential as id `PG` (every workflow node references that id, so
   they all bind automatically), and imports the workflow definitions. To re-run
   or to import after a manual `docker compose up`:
   ```bash
   ./scripts/bootstrap_n8n.sh
   ```
   Threads API calls read their token from the database, not from an n8n
   credential — there is no HTTP Header Auth credential to assign.

6. **Activate workflows** once the Threads token is in place:
   ```bash
   ./scripts/bootstrap_n8n.sh --activate   # wf0, wf6, wf3, wf7
   cd infra && docker compose restart n8n  # activation needs a restart
   ```
   - ⏳ `wf2_generate` (after 14 days, when warm-up phase ends)
   - ⏳ `wf4_evaluate` (after first posts are published)

   Activate *after* the token exists — otherwise `wf3_publish` logs a failed
   execution every 5 minutes.

### Done! 🎉

Your system is now:
- Posting 4 persona posts/day (warm-up phase)
- Replying to comments automatically
- Building account trust before selling

---

## Scenario B: Existing VPS (Update to Latest)

**Requirements:** ThreadsFlow already running with Docker

### One-Click Update

```bash
cd /path/to/threadsflow_arena.AI
./scripts/update_existing_vps.sh
```

### What the script does:
1. ✅ Pulls latest code from Git
2. ✅ Runs new migrations (011, 012, 013 if not applied)
3. ✅ Seeds new techniques (psychology, Malaysian snippets)
4. ✅ Restarts Docker services
5. ✅ Shows what's new

### After Update (2 minutes)

1. **Import/update workflows into n8n:**
   ```bash
   ./scripts/bootstrap_n8n.sh
   ```
   This imports `wf7_l4_reply.json`, `wf6_persona.json`, and the rest of the workflow JSONs with the `PG` Postgres credential already bound.

2. **Activate `wf7_l4_reply` only after the Threads token is available:**
   ```bash
   ./scripts/bootstrap_n8n.sh --activate
   cd infra && docker compose restart n8n
   ```
   Current caveat: `wf7_l4_reply.json` reads `settings.l4_reply.threads_token`; ensure that key is populated before relying on L4 replies.

3. **(Optional) Import more Malaysian datasets:**
   ```bash
   ./scripts/import_malaysian_datasets.sh
   ```

### Done! 🎉

You now have:
- ✅ L4 Reply Loop (automatic comment replies with psychology techniques)
- ✅ 17 psychology techniques (Cialdini, Voss, Dhawan, Handley, Carnegie, Bacon)
- ✅ 177 Malaysian persona snippets (9 domains)
- ✅ Time-of-day topic affinity

---

## Feature Status

| Feature | Status | Auto-Enabled |
|---|---|---|
| **Media schema** | ✅ 5 `posts.media_type` values: `TEXT`, `IMAGE`, `CAROUSEL`, `VIDEO`, `MIXED_CAROUSEL`; `product_images.media_kind` is `IMAGE`/`VIDEO` | Yes |
| **Browser product media intake** | ✅ JPG/PNG images; backend API also accepts WebP/MP4/MOV | Yes |
| **Video/mixed publishing** | ⚠️ Schema + bandit groundwork only; `wf3_publish.json` currently lacks VIDEO/MIXED routes and async status polling | No |
| **Settings UI** | ⚠️ `/settings.html` edits LLM config only; no 5-tab System Settings Control Board in current code | Yes, LLM only |
| **Persona warm-up (wf6)** | ✅ Running | Yes |
| **L4 reply loop (wf7)** | ⚠️ Workflow exists; needs `threads_comments` ingestion and `settings.l4_reply.threads_token` before live replies | Yes when activated |
| **Psychology techniques** | ✅ Loaded | Yes |
| **Malaysian snippets** | ✅ Seeded | Yes |
| **Time-of-day affinity** | ✅ Active | Yes |
| **Post generation (wf2)** | ⏳ Wait 14 days | After warm-up |
| **Evaluation (wf4)** | ⏳ Wait for posts | After first publish |
| **Shopee API** | 🔧 Optional | Add keys when ready |
| **Karma workflow** | 📋 Draft | Waiting for Meta API |

---

## Quick Commands

```bash
# View logs
docker compose -f infra/docker-compose.yml logs -f n8n

# Restart services
cd infra && docker compose restart

# Check database
docker compose -f infra/docker-compose.yml exec postgres psql -U threadsflow -d threadsflow

# List queued posts
docker compose -f infra/docker-compose.yml exec postgres psql -U threadsflow -d threadsflow \
  -c "SELECT uid, purpose, scheduled_at FROM posts WHERE status='queued' ORDER BY scheduled_at"

# List published posts
docker compose -f infra/docker-compose.yml exec postgres psql -U threadsflow -d threadsflow \
  -c "SELECT uid, purpose, published_at FROM posts WHERE status='published' ORDER BY published_at DESC LIMIT 10"

# Check L4 replies
docker compose -f infra/docker-compose.yml exec postgres psql -U threadsflow -d threadsflow \
  -c "SELECT comment_id, intent, status FROM l4_replies ORDER BY created_at DESC LIMIT 10"

# Import Malaysian datasets
./scripts/import_malaysian_datasets.sh

# Update to latest
./scripts/update_existing_vps.sh
```

---

## Troubleshooting

### Services won't start
```bash
cd infra && docker compose logs
```

### Database connection failed
```bash
docker compose -f infra/docker-compose.yml exec postgres pg_isready -U threadsflow
```

### n8n not accessible
- Check Cloudflare Tunnel is running: `docker compose -f infra/docker-compose.yml ps cloudflared`
- Check n8n logs: `docker compose -f infra/docker-compose.yml logs n8n`

### Workflows not running
- Check if activated in n8n UI
- Check credentials are assigned
- Check execution logs in n8n

### No posts being generated
- During warm-up (first 14 days): only `wf6_persona` should be active
- After warm-up: activate `wf2_generate`
- Check `posts` table: `SELECT * FROM posts ORDER BY created_at DESC LIMIT 5`

---

## Documentation

- **Full runbook:** `docs/03-setup-runbook.md`
- **Architecture:** `docs/01-architecture.md`
- **Workflows:** `docs/02-n8n-workflows.md`
- **Persona warm-up:** `docs/06-persona-warmup.md`
- **L4 reply loop:** `docs/07-l4-reply-loop.md`
- **Malaysian dataset:** `docs/10-malaysian-dataset.md`
- **72h canary:** `docs/08-72h-canary.md`

---

## Support

- **Issues:** https://github.com/SuperDuperNoob/threadsflow_arena.AI/issues
- **Discussions:** https://github.com/SuperDuperNoob/threadsflow_arena.AI/discussions

---

**Last updated:** 2026-07-31  
**Version:** 2.0 (with L4, psychology, Malaysian dataset)
