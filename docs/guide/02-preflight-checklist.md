# Pre-Flight Checklist — Zero Setup to Agent-Ready

Follow this top to bottom before handing the VPS/repo to an agent for deployment. Each item links to the sourcing row in [`01-credential-sourcing.md`](01-credential-sourcing.md).

## Human/platform setup

1. **Create or obtain the VPS** — see [VPS with SSH root/sudo access](01-credential-sourcing.md#cred-vps). Confirm the agent will run as root or a sudo-capable user.

2. **Register a domain and move DNS to Cloudflare** — see [Domain name + Cloudflare DNS zone](01-credential-sourcing.md#cred-domain). Decide these exact hostnames now:
   - `N8N_HOST=n8n.yourdomain.com`
   - `kb.yourdomain.com` for KB UI/API
   - `PUBLIC_REDIRECT_BASE=https://r.yourdomain.com`
   - `PUBLIC_IMAGE_BASE=https://cdn.yourdomain.com` if using an R2 custom domain, or the r2.dev public URL if not.

3. **Create the Cloudflare Tunnel token** — see [`CF_TUNNEL_TOKEN`](01-credential-sourcing.md#cred-cloudflare-tunnel). Place it in:
   ```env
   infra/.env -> CF_TUNNEL_TOKEN=...
   ```
   Also configure public hostnames in Cloudflare Zero Trust:
   - `n8n.yourdomain.com` → `http://n8n:5678` with Access protection
   - `kb.yourdomain.com` → `http://kb:8082` with Access protection
   - `r.yourdomain.com` → `http://redirector:8081` public/no Access

4. **Create the Cloudflare R2 bucket and S3 token** — see [Cloudflare R2 bucket + S3 credentials](01-credential-sourcing.md#cred-r2). Place:
   ```env
   infra/.env -> IMAGE_BACKEND=s3
   infra/.env -> S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
   infra/.env -> S3_BUCKET=threadsflow
   infra/.env -> S3_KEY=...
   infra/.env -> S3_SECRET=...
   infra/.env -> PUBLIC_IMAGE_BASE=https://cdn.yourdomain.com   # or r2.dev public URL
   ```

5. **Create the LLM provider key or confirm a no-auth endpoint** — see [OpenAI-compatible LLM endpoint/key](01-credential-sourcing.md#cred-llm). Place:
   ```env
   infra/.env -> LLM_BASE_URL=https://.../v1
   infra/.env -> LLM_API_KEY=...
   infra/.env -> LLM_MODEL_WRITE=...
   infra/.env -> LLM_MODEL_EDIT=...
   infra/.env -> LLM_MODEL_EMBED=...
   infra/.env -> LLM_MODEL_MINE=...
   ```
   After the DB is running, run `./scripts/configure_llm.sh` or save once in `/settings.html` so `settings.llm` matches `.env`.

6. **Create the Meta/Threads app and token** — see [Threads long-lived token + numeric user id](01-credential-sourcing.md#cred-threads). After DB initialization, place it with:
   ```bash
   ./scripts/set_secrets.sh --threads-token 'TOKEN' --threads-user-id 'NUMERIC_ID'
   ```
   This single command now populates both `settings.threads_creds` and `settings.l4_reply.threads_token` (`scripts/set_secrets.sh:135-141`), so no separate SQL patch is needed.

7. **Optional: create Shopee Affiliate Open API credentials** — see [Shopee Affiliate Open API App ID/API Secret](01-credential-sourcing.md#cred-shopee). Place if/when approved:
   ```env
   infra/.env -> SHOPEE_API_APP_ID=...
   infra/.env -> SHOPEE_API_SECRET=...
   ```
   `scripts/set_secrets.sh --shopee-app-id --shopee-secret` now writes **both** `shopee_app_id` and `shopee_app_secret` settings rows
   (`scripts/set_secrets.sh:150-161`), matching `services/kb/lib/shopee.js:58-59`. The DB path now works alongside env vars.

8. **Optional: create a Perplexity key for topic refresh** — see [Perplexity API key](01-credential-sourcing.md#cred-perplexity). Place:
   ```env
   infra/.env -> PERPLEXITY_API_KEY=...
   infra/.env -> PERPLEXITY_MODEL=sonar
   ```

## Agent handoff package

Before handoff, the agent should have:

1. SSH/root/sudo access to the VPS.
2. Repository checked out or permission to clone it.
3. `infra/.env` containing all required external values above plus generated Tier A secrets if setup was already run.
4. Threads token and numeric user id ready for `scripts/set_secrets.sh` after DB init, or already stored in the DB.
5. Clear instruction **not** to obtain Meta/Threads/Shopee/Cloudflare/domain credentials by browser automation.

## Minimum required for live product posting

Required:

- VPS access
- Domain/Cloudflare DNS active
- `CF_TUNNEL_TOKEN`
- R2/public media settings: `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`, `S3_SECRET`, `PUBLIC_IMAGE_BASE`
- Redirect base: `PUBLIC_REDIRECT_BASE`
- Working LLM config/key unless using a no-auth endpoint
- Threads token + user id in `settings.threads_creds`

Optional for first launch:

- Shopee Open API credentials — click tracking still works without order attribution.
- Perplexity API key — persona warm-up has seeded topics without it.

## Current feature caveats to remember

- Browser `/product.html` accepts JPG/PNG images only. Backend `POST /api/products` accepts WebP/MP4/MOV too, but live `wf3_publish` does not safely publish `VIDEO` or `MIXED_CAROUSEL` yet.
- `/settings.html` is a 6-tab Control Board (LLM, posting, bandit, qa, l4_reply, warmup, scoring) using generic `GET/PUT /api/config/system/:key`. All settings editable via UI.
- `wf7_l4_reply` needs `settings.l4_reply.threads_token`; `scripts/set_secrets.sh` writes it alongside `threads_creds`.
