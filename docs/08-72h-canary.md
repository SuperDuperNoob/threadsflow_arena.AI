# 72-hour live debug / canary mode

The first public deployment is the one time you want *more* visibility, not less. Canary
mode turns on extra structured logs across the stack for a bounded window, plus an
observer script that snapshots stack health every few minutes. It is designed to be safe:
**no secrets in logs, no disk fill, and it turns itself off.**

## Is this live or a mock?

**Live. Real posts, real money.** Canary mode only adds *observability* — it changes
zero behavior. During the 72 hours:

- wf2 generates real posts and queues them nightly
- wf3 actually publishes them to Threads via the Graph API
- CTA replies go out with real affiliate links
- Real buyers hit the redirector; real clicks and commissions are recorded

Nothing "switches on" after 72 hours — the system was already doing real work. The only
thing that changes is that debug logging expires (`DEBUG_UNTIL`) and you quiet the config
back down (section 4).

**Want a dry-run first?** Use the built-in draft mode from the runbook (Step 7): open
`wf2_generate` in n8n, find the **Queue post** node, and change `'queued'` to `'draft'`
in the INSERT. wf2 then writes full real posts every night but wf3 skips them (it only
picks up `status='queued'`), so nothing reaches Threads. Read the drafts in the database,
ban robotic phrases, then flip `'draft'` back to `'queued'` to go live.

A sensible first-deployment sequence:

| Phase | wf2 writes | Publishes to Threads? | Debug |
|---|---|---|---|
| Days 1–2 (optional dry-run) | `draft` | No | `DEBUG_MODE=true`, observer running |
| Days 3–5 (72h canary) | `queued` | **Yes — real** | `DEBUG_MODE=true`, `DEBUG_UNTIL` set, observer running |
| Steady state | `queued` | Yes | `DEBUG_MODE=false`, `LOG_LEVEL=info` |

Before the canary counts as "live", the prerequisites from the runbook must be real:
Threads token in `settings.threads_creds`, Cloudflare Tunnel hostnames, image hosting
(R2), a reachable LLM endpoint, at least one product added via the KB, and the workflows
toggled active in n8n. The canary is precisely what tells you within hours if any of
those are misconfigured, instead of a week later.

What it gives you:

- Structured JSON logs (one line per event) from `kb` and `redirector` — service, level,
  event, timestamp, metadata. All values pass through a masking layer: API keys, bearer
  tokens, Threads/Meta tokens, Shopee secrets and URL query strings (affiliate SubIds,
  `access_token=` params) are replaced with `***` before serialization. Generated text is
  never logged in full — snippets are truncated to 120 chars.
- `run_log` checkpoints from wf2 (slot built, LLM failure, QA rejection, post queued) and
  wf3 (due post fetched, quota checked, container created, post published, CTA
  skipped/published, publish failure). These go to Postgres, so
  `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none` stays as-is in production — n8n never stores
  successful execution payloads (which contain the Threads token).
- Docker `json-file` log rotation on every service (10 MB × 5 files = max 50 MB per
  container), so even `LOG_LEVEL=debug` for three days cannot fill the disk.
- `scripts/observe_72h.sh` — a low-dependency observer loop writing to
  `logs/observe_72h.log` (gitignored).

---

## 1 — Enable debug mode

Edit `infra/.env` and set:

```bash
DEBUG_MODE=true
# 3 days from now, ISO format (UTC). After this moment the code automatically behaves
# as if debug were disabled — you cannot forget to turn it off.
#   date -u -d '+3 days' +%Y-%m-%dT%H:%M:%SZ
DEBUG_UNTIL=2026-08-02T00:00:00Z
LOG_LEVEL=debug
```

How the three knobs interact:

| Variable | Effect |
|---|---|
| `LOG_LEVEL` | Minimum level emitted: `debug` / `info` / `warn` / `error`. Default `info`. |
| `DEBUG_MODE` | Must be `true` for `debug`-level events to be emitted at all. Anything other than the literal string `true` (including `false`, empty, or unset) means debug off. |
| `DEBUG_UNTIL` | Optional ISO timestamp. Once the clock passes it, debug events stop — live, no restart needed. Empty = no expiry. |

The two states at a glance:

| | Canary (first 72h) | Production (steady state) |
|---|---|---|
| `DEBUG_MODE` | `true` | `false` |
| `DEBUG_UNTIL` | `<now + 3 days, ISO>` | *(empty)* |
| `LOG_LEVEL` | `debug` | `info` |
| debug events emitted | yes, until `DEBUG_UNTIL` passes | no |
| info/warn/error events | yes | yes |
| secret masking | always on | always on |
| behavior of wf2/wf3/redirector | unchanged — real publishing | unchanged — real publishing |

Note: `DEBUG_MODE=true` with `LOG_LEVEL=info` emits **no** debug events — the level
filter runs first. For the canary you want both: `DEBUG_MODE=true` **and**
`LOG_LEVEL=debug`.

Then recreate the containers so they pick up the new environment:

```bash
cd infra
docker compose up -d
```

Verify — the startup line of each service reports its own debug state:

```bash
docker compose logs kb | grep '"event":"startup"'
docker compose logs redirector | grep '"event":"startup"'
```

You should see `"debug_mode":true` and your `debug_until` value, and **no secret values**
(only booleans like `api_key_set`/`s3_configured` and host names).

## 2 — Start the observer

From the repo root:

```bash
./scripts/observe_72h.sh
```

Run it under `tmux`/`screen` or `nohup` so it survives your SSH session:

```bash
nohup ./scripts/observe_72h.sh >/dev/null 2>&1 &
```

Configuration (all via environment variables):

```bash
COMPOSE_FILE=infra/docker-compose.yml   # default
INTERVAL_SECONDS=300                    # snapshot every 5 minutes (default)
HOURS=72                                # total observation window (default)
KB_HEALTH_URL=https://kb.yourdomain.com/healthz          # optional curl check
REDIRECTOR_HEALTH_URL=https://r.yourdomain.com/healthz   # optional curl check
```

Each snapshot appends to `logs/observe_72h.log`:

- `docker compose ps` (flags restart loops / exited / unhealthy containers)
- recent error lines from `kb` / `redirector` / `n8n` container logs
- optional curl health checks
- Postgres: posts by status, `run_log` levels in the last hour, clicks in the last hour,
  the 10 most recent posts
- disk and memory headroom

It needs nothing beyond `docker compose`, `curl` and `psql` *inside the postgres
container* — no host-side database client.

## 3 — Pass / fail criteria

Review `logs/observe_72h.log` at least daily. The canary **passes** when, across the full
72 hours:

| Check | Pass looks like |
|---|---|
| No restart loops | Every snapshot shows all containers `Up`; no `restarting`/`exited`. |
| wf2 queues posts | `posts by status` shows `queued` rows appearing daily after the 03:00 run; `run_log` has `post queued` entries. |
| wf3 publishes posts | `queued` rows move to `published`; `run_log` has `post published` entries; `failed` stays rare. |
| CTA replies work | `run_log` shows `CTA reply published` for `sell_intensity > 0` posts (and `CTA skipped` for the daily free slot). |
| Redirector healthy | `REDIRECTOR_HEALTH_URL` returns 200 in every snapshot; `redirect_hit` events appear in its logs. |
| Click rows appear | `clicks (last hour)` is non-zero within a day of the first published post with a CTA. |
| LLM failures retried & rare | `llm_call_retry` warnings occasional; `llm_call_failed` errors rare; `run_log` error level count per hour stays near zero. |
| No secrets in logs | Spot-check: `docker compose logs kb redirector \| grep -Ei 'sk-\|Bearer \|access_token=' \| grep -v '\*\*\*'` returns nothing. |
| Disk/memory stable | `df`/`free` lines in the log show no steady climb; container log dirs are capped by rotation anyway. |

Any failed criterion: fix, and restart the 72-hour clock for the affected area.

## 4 — Turn debug off after 72 hours

If you set `DEBUG_UNTIL`, debug logging **already stopped by itself** — nothing is
leaking verbosity. Still, tidy up the config:

```bash
# infra/.env
DEBUG_MODE=false
DEBUG_UNTIL=
LOG_LEVEL=info
```

```bash
cd infra
docker compose up -d          # recreate with the quieter settings
```

Stop the observer if it is still running (`pkill -f observe_72h.sh`), archive or delete
`logs/observe_72h.log`, and optionally prune old debug rows:

```bash
docker compose exec postgres psql -U threadsflow -d threadsflow \
  -c "DELETE FROM run_log WHERE level='debug' AND ts < now() - interval '7 days';"
```

Leave `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none` exactly as it is — that setting is what
keeps Threads tokens out of n8n execution history, canary or not.

---

## Official references

**Docker**

- `docker compose` CLI (what `observe_72h.sh` drives): https://docs.docker.com/reference/cli/docker/compose/
- Docker log drivers and `json-file` rotation (`max-size` / `max-file`, used in our compose): https://docs.docker.com/config/containers/logging/json-file/
- Docker healthchecks (the `healthz` endpoints curl'd by the observer align with Docker's HEALTHCHECK convention): https://docs.docker.com/reference/dockerfile/#healthcheck

**n8n**

- Execution data / privacy (`EXECUTIONS_DATA_SAVE_ON_SUCCESS`, `EXECUTIONS_DATA_MAX_AGE`, why this matters for tokens): https://docs.n8n.io/hosting/configuration/executions/
- Environment variables reference: https://docs.n8n.io/hosting/configuration/environment-variables/

**PostgreSQL**

- `psql` command-line client (used inside the `postgres` container by `observe_72h.sh`): https://www.postgresql.org/docs/current/app-psql.html
- Routine `VACUUM` / data retention (the `DELETE FROM run_log` cleanup at the end): https://www.postgresql.org/docs/current/routine-vacuuming.html

**tmux / screen / nohup** (keeping the observer alive across SSH disconnects)

- tmux: https://manpages.debian.org/bookworm/tmux/tmux.1.en.html
- nohup: https://manpages.debian.org/bookworm/coreutils/nohup.1.en.html
