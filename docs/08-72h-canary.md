# 72-hour live debug / canary mode

The first public deployment is the one time you want *more* visibility, not less. Canary
mode turns on extra structured logs across the stack for a bounded window, plus an
observer script that snapshots stack health every few minutes. It is designed to be safe:
**no secrets in logs, no disk fill, and it turns itself off.**

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
| `DEBUG_MODE` | Must be `true` for `debug`-level events to be emitted at all. |
| `DEBUG_UNTIL` | Optional ISO timestamp. Once the clock passes it, debug events stop — live, no restart needed. Empty = no expiry. |

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
