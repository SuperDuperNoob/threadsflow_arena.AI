#!/usr/bin/env bash
# ThreadsFlow 72-hour canary observer.
#
# Polls the stack every INTERVAL_SECONDS for HOURS hours and appends a compact health
# snapshot to logs/observe_72h.log. Needs nothing beyond docker compose, curl (optional)
# and psql *inside the postgres container* — no host-side psql required.
#
# Usage:
#   ./scripts/observe_72h.sh                 # 72h, every 300s
#   INTERVAL_SECONDS=60 HOURS=1 ./scripts/observe_72h.sh
#   KB_HEALTH_URL=https://kb.example.com/healthz \
#   REDIRECTOR_HEALTH_URL=https://r.example.com/healthz ./scripts/observe_72h.sh
#
# Pass/fail criteria and how to read the output: docs/08-72h-canary.md

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

COMPOSE_FILE="${COMPOSE_FILE:-infra/docker-compose.yml}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-300}"
HOURS="${HOURS:-72}"
LOG_TAIL="${LOG_TAIL:-20}"                   # lines of container logs shown when errors are found
KB_HEALTH_URL="${KB_HEALTH_URL:-}"           # optional, e.g. https://kb.yourdomain.com/healthz
REDIRECTOR_HEALTH_URL="${REDIRECTOR_HEALTH_URL:-}"
LOG_DIR="logs"
LOG_FILE="$LOG_DIR/observe_72h.log"

mkdir -p "$LOG_DIR"

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

# All Postgres queries run through the container so the host needs no psql install.
pg() {
  compose exec -T postgres psql -U threadsflow -d threadsflow -X -q -P pager=off -c "$1" 2>&1 || true
}

say() { printf '%s\n' "$*" | tee -a "$LOG_FILE"; }

section() { say ""; say "── $* ─────────────────────────────────────"; }

check_health_url() {
  local name="$1" url="$2"
  [ -z "$url" ] && return 0
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>>"$LOG_FILE" || echo "000")
  if [ "$code" = "200" ]; then
    say "health $name: OK ($url -> $code)"
  else
    say "health $name: FAIL ($url -> $code)"
  fi
}

END_TS=$(( $(date +%s) + HOURS * 3600 ))
ITER=0

say "════════════════════════════════════════════════════════════════"
say "observe_72h started $(date -u +%Y-%m-%dT%H:%M:%SZ)"
say "compose=$COMPOSE_FILE interval=${INTERVAL_SECONDS}s duration=${HOURS}h log=$LOG_FILE"
say "════════════════════════════════════════════════════════════════"

while [ "$(date +%s)" -lt "$END_TS" ]; do
  ITER=$((ITER + 1))
  say ""
  say "══════ snapshot #$ITER  $(date -u +%Y-%m-%dT%H:%M:%SZ) ══════"

  section "docker compose ps"
  compose ps 2>&1 | tee -a "$LOG_FILE" || say "compose ps failed"

  # Restart-loop detection: any container not Up / restarting is a red flag.
  if compose ps 2>/dev/null | grep -Eiq 'restarting|exited|unhealthy'; then
    say "WARNING: container not healthy — recent logs below"
    for svc in kb redirector n8n; do
      section "logs: $svc (last $LOG_TAIL)"
      compose logs --no-color --tail "$LOG_TAIL" "$svc" 2>&1 | tee -a "$LOG_FILE" || true
    done
  else
    # Even when healthy, surface recent error lines from the three key services.
    for svc in kb redirector n8n; do
      errs=$(compose logs --no-color --tail 200 "$svc" 2>/dev/null | grep -Eic '"level":"error"|ERROR' || true)
      if [ "${errs:-0}" -gt 0 ]; then
        section "recent errors in $svc ($errs in last 200 lines)"
        compose logs --no-color --tail 200 "$svc" 2>/dev/null \
          | grep -Ei '"level":"error"|ERROR' | tail -n "$LOG_TAIL" | tee -a "$LOG_FILE" || true
      fi
    done
  fi

  section "health endpoints"
  if [ -n "$KB_HEALTH_URL$REDIRECTOR_HEALTH_URL" ]; then
    check_health_url kb "$KB_HEALTH_URL"
    check_health_url redirector "$REDIRECTOR_HEALTH_URL"
  else
    say "(set KB_HEALTH_URL / REDIRECTOR_HEALTH_URL to enable curl checks)"
  fi

  section "posts by status"
  pg "SELECT status, count(*) FROM posts GROUP BY status;" | tee -a "$LOG_FILE"

  section "run_log levels (last hour)"
  pg "SELECT level, count(*) FROM run_log WHERE ts > now() - interval '1 hour' GROUP BY level;" | tee -a "$LOG_FILE"

  section "clicks (last hour)"
  pg "SELECT count(*) FROM clicks WHERE ts > now() - interval '1 hour';" | tee -a "$LOG_FILE"

  section "latest 10 posts"
  pg "SELECT uid, status, media_type, scheduled_at FROM posts ORDER BY id DESC LIMIT 10;" | tee -a "$LOG_FILE"

  section "disk / memory"
  df -h / 2>/dev/null | tail -n 1 | tee -a "$LOG_FILE" || true
  free -m 2>/dev/null | head -n 2 | tail -n 1 | tee -a "$LOG_FILE" || true

  # Stop cleanly if the remaining window is shorter than one interval.
  NOW=$(date +%s)
  [ $((END_TS - NOW)) -le 0 ] && break
  SLEEP=$(( END_TS - NOW < INTERVAL_SECONDS ? END_TS - NOW : INTERVAL_SECONDS ))
  sleep "$SLEEP"
done

say ""
say "observe_72h finished $(date -u +%Y-%m-%dT%H:%M:%SZ) after $ITER snapshots"
