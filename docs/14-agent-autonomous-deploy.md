# Can an agent with MCP skills deploy this by itself?

**Short answer: no — not one-click, and the MCP skill list is not the reason.**

An agent already on the VPS with `run_commands` can do ~85% of the deploy without
any MCP servers at all, because this repo is shell scripts + Docker Compose. What
blocks full autonomy is four credentials that are gated behind human identity
checks and browser consent screens. No MCP server can click those.

This document is the honest accounting: what is automated now, what is not, and
why.

---

## The three-tier reality

| Tier | What | Who does it |
|---|---|---|
| **1. Fully automatable** | Docker, DB schema, 20 migrations, seeds, services, n8n owner + credential + workflow import | The agent, unattended |
| **2. Agent-assisted** | Cloudflare Tunnel + R2 + DNS | Agent *can* do it via Cloudflare API — but only after a human creates the first API token |
| **3. Human-only** | Threads token, Meta app review, Shopee Open API approval | Human. Always. |

---

## Tier 3 — why these can never be one-click

### Threads access token (hard blocker)

Publishing needs a token from Meta's OAuth consent screen. Getting one requires:

- A Meta developer account tied to a **verified identity** (phone/ID).
- Adding your Threads account under **Roles → Threads Testers** and accepting
  the invite *from inside the Threads app*.
- Clicking through an OAuth consent dialog in a browser as a logged-in human.

Beyond testers, Meta additionally requires **Tech Provider verification** and
per-permission **App Review** with a screencast — typically 2–6 weeks. This is a
deliberate anti-automation control; an agent driving it with Playwright would be
attempting to defeat an identity check, which is exactly the thing that gets
accounts banned. **Do not automate this.**

The token also expires every 60 days. `wf0_token_refresh` handles the refresh
automatically once the *first* token exists — the manual step happens once.

### Cloudflare Tunnel token and R2 keys

`CF_TUNNEL_TOKEN`, `S3_KEY`, `S3_SECRET` are all obtainable from the Cloudflare
API — but every path bottoms out at a **root API token that a human must create
in the dashboard**. R2 makes this sharper: the S3 secret is the SHA-256 of the
API token value, shown exactly once at creation.

So this tier is "one-time human bootstrap, then scriptable" — not zero-touch.

### Shopee Affiliate Open API

Requires an approved affiliate account. Approval is a manual review of a real
person's application. The system degrades gracefully without it (click tracking
still works; only order attribution waits), so this does not block launch.

---

## What was actually broken (and is now fixed)

The repo *claimed* one-click setup. Testing the claim against a real Postgres
turned up four bugs that would have bitten a real deploy. All are fixed, and all
are pinned by regression tests in
`services/kb/test/deploy.integration.test.mjs`.

### 1. Setup script corrupted its own passwords ~40% of the time

`setup_new_vps.sh` generated secrets with `openssl rand -base64`, then injected
them with `sed -i "s/placeholder/$PASSWORD/"`. base64 emits `/`, which
terminates the `s` command.

Measured over 200 random base64 passwords: **80 hard failures (40%)**. With
`set -euo pipefail`, the script aborts mid-setup.

Worse, the ones that "succeeded" could still be broken: `DATABASE_URL` embeds
the password as `postgres://user:PASS@host`, so a `/` or `@` silently truncates
the connection string. The template's `DATABASE_URL` was never updated at all,
so it kept the literal `change_me_long_random` — every service reading it (kb,
redirector, shopee-sync) would fail to connect.

**Fix:** hex secrets (URL-safe and sed-safe), key-anchored `sed` with a `|`
delimiter, and `DATABASE_URL` regenerated from the same password.
Re-measured: **0 failures in 500 runs, 0 DSN mismatches.**

### 2. Two migrations crashed on re-run

Both `init_db.sh` and `setup_new_vps.sh` replay *every* `db/migrations/*.sql` on
every invocation. Against a real Postgres, 2 of 20 aborted the second time:

- `012` — `duplicate key ... persona_snippets_text_sha256_key`
- `014` — `duplicate key ... persona_topics_source_id_topic_key`

Since these run under `ON_ERROR_STOP=1` with `set -e`, re-running setup on an
existing box — the documented recovery path — **fails partway through**.

**Fix:** added `ON CONFLICT ... DO NOTHING`. Now **20/20 re-run clean.**

### 3. Migration 014 poisoned the warm-up content pool

This one is subtle and matters most for output quality. The migration inserted
25 "follow me back" topics with:

```sql
FROM persona_topic_sources, LATERAL (VALUES ...)
```

An unfiltered cross join. It attached all 25 topics to **all 5 sources** — 125
rows instead of 25.

Measured effect on the topic pool the warm-up bandit samples from:

| | total topics | follow_request | share |
|---|---|---|---|
| before | 249 | 125 | **50%** |
| after | 149 | 25 | **17%** |

Half of all warm-up posts would have been "follow me back, I follow back" — on
an account whose entire purpose is looking like a normal human before it ever
sells anything. That is the fastest way to get flagged as spam.

**Fix:** constrained the join to the `follow_request` source. The test asserts
both the source isolation and a ≤20% share of the pool.

### 4. n8n: dead auth config, unpinned image, and imports that never happened

- **`N8N_BASIC_AUTH_ACTIVE`** was set in compose. It was removed in n8n **v1**
  and is ignored in **v2** — it protected nothing while looking like it did.
- **`image: n8n:latest`** now resolves to **v2.32.7**. v2 changed
  active/inactive to publish/unpublish, enabled task runners, and blocks env
  access in Code nodes — an unrelated `docker compose up -d` could take a
  working deploy down. Now pinned to `1.123.67` via `${N8N_VERSION}`.
- **Step 7 "Importing n8n workflows" imported nothing.** It ran
  `populate_workflows.js`, which only rewrites local JSON files — it makes no
  network calls. It also polled `http://localhost:5678/healthz`, which can never
  respond, because compose publishes **no ports** (Cloudflare Tunnel only). So
  it printed a success-shaped message and moved on, leaving ~15 minutes of
  manual UI clicking undocumented.

---

## New: `scripts/bootstrap_n8n.sh`

Closes the gap that Step 7 pretended to cover.

```bash
./scripts/bootstrap_n8n.sh              # owner + credential + workflows
./scripts/bootstrap_n8n.sh --activate   # also switch on wf0/wf6/wf3/wf7
```

The load-bearing trick: every Postgres node in every workflow already references
credential id `PG`. Importing a credential whose id is literally `PG` binds all
of them at once — no per-node reassignment.

```
n8n/workflows/*.json  →  credentials: { postgres: { id: "PG", ... } }
scripts/bootstrap_n8n.sh  →  imports credential with "id": "PG"
                          →  every node resolves automatically
```

Credential field names (`host`, `database`, `user`, `password`, `ssl`, `port`,
`maxConnections`, `allowUnauthorizedCerts`, `sshTunnel`) were verified against
the real `n8n-nodes-base` Postgres credential class, not guessed.

Activation is opt-in on purpose: turning on `wf3_publish` before a Threads token
exists just generates a failed execution every 5 minutes.

## New: `scripts/set_secrets.sh`

The Threads token and Shopee keys live in the Postgres `settings` table, not
`.env`. The runbook had you hand-write raw SQL.

```bash
./scripts/set_secrets.sh --threads-token 'THQVJ...' --threads-user-id '178414...'
./scripts/set_secrets.sh --show
```

It validates the token against `graph.threads.net/v1.0/me` **before** storing —
a bad token otherwise fails silently every 5 minutes inside `wf3_publish` — and
auto-corrects a mismatched user id from the API response.

It also fixes a real trap: the runbook's `UPDATE settings SET value =
jsonb_set(...)` **silently does nothing when the row does not exist** (verified:
0 rows affected, exit code 0). `set_secrets.sh` uses an upsert that creates the
row, preserves sibling keys on rotation, and passes values as query parameters
so tokens containing quotes or backslashes cannot break or inject.

It writes both `threads_creds` and `l4_config.threads_token`, which `wf7_l4_reply`
reads separately — easy to miss by hand.

---

## The realistic deploy today

```bash
# 1. Agent, unattended (~10 min)
curl -sSL .../scripts/setup_new_vps.sh | sudo bash

# 2. Human, once: paste 4 values into infra/.env
#    CF_TUNNEL_TOKEN, S3_KEY, S3_SECRET, LLM_API_KEY
cd infra && docker compose up -d

# 3. Human, once: the Meta OAuth dance, then hand the result to the agent
./scripts/set_secrets.sh --threads-token '...' --threads-user-id '...'

# 4. Agent, unattended
./scripts/bootstrap_n8n.sh --activate
```

**One human checkpoint, not fifteen.** That is as close to one-click as this
architecture can honestly get, and the remaining step is a deliberate identity
control rather than missing automation.

---

## On the MCP skill list

The skills in your table mostly do not change the answer:

- **cloudflare MCP** — genuinely useful for tier 2 (tunnel, DNS, R2 buckets),
  but still needs a human-created API token first.
- **context7 / github / filesystem / git / sequentialthinking** — useful while
  *building*, irrelevant to *deploying* this stack.
- **n8n-mcp** — its management tools need `N8N_API_URL` + `N8N_API_KEY`, and an
  n8n API key can only be minted from the UI after an owner account exists.
  `bootstrap_n8n.sh` uses the n8n **CLI** instead, which needs no API key and
  works before any owner exists.
- **playwright** — the one that looks like it solves the Threads token. It does
  not: driving Meta's login and consent screens with a headless browser means
  defeating an identity check, and it is the single fastest way to lose the
  account this system exists to grow.

The bottleneck was never tool access. It was four bugs in the setup path and one
irreducible human identity check.

---

## Verification

```bash
npm --prefix services/kb test     # 29/29 pass (was 24, +5 deploy regressions)
```

The 5 new tests were confirmed non-vacuous by reverting each fix: **4 fail on
the original code, all 5 pass on the fixed code.** The fifth documents the SQL
contract for the token upsert.
