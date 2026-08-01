#!/usr/bin/env bash
# ThreadsFlow — write the DB-held secrets that do NOT live in infra/.env.
#
# Some credentials are read from the Postgres `settings` table, not the
# environment: the Threads token, the Shopee Open API keys, and the L4 reply
# config. The runbook has you hand-write raw SQL for these, which is easy to
# get wrong (jsonb_set on a missing row silently does nothing).
#
# Usage:
#   ./scripts/set_secrets.sh --threads-token 'THQVJ...' --threads-user-id '1234567890'
#   ./scripts/set_secrets.sh --shopee-app-id '15xxxx' --shopee-secret 'abc...'
#   ./scripts/set_secrets.sh --show
#
# Values are passed to psql as parameters, never interpolated into the SQL
# string, so tokens containing quotes or backslashes cannot break or inject.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RED='\033[0;31m'; NC='\033[0m'
log()     { echo -e "${BLUE}[secrets]${NC} $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1" >&2; }

COMPOSE="docker compose -f infra/docker-compose.yml"

THREADS_TOKEN=""; THREADS_USER_ID=""
SHOPEE_APP_ID="";  SHOPEE_SECRET=""
SHOW=false

usage() {
  cat <<'HELP'
Write DB-held ThreadsFlow secrets into the Postgres `settings` table.

Options:
  --threads-token TOKEN     Long-lived Threads access token (60-day)
  --threads-user-id ID      Numeric Threads user id
  --shopee-app-id ID        Shopee Affiliate Open API App ID
  --shopee-secret SECRET    Shopee Affiliate Open API secret
  --show                    Print which secrets are set (masked)
  -h, --help                This help

Get a Threads token (both values at once):
  1. developers.facebook.com -> your app -> Use cases -> Access the Threads API
  2. Add permissions: threads_basic, threads_content_publish,
     threads_manage_replies, threads_manage_insights
  3. Add your Threads account under Roles -> Threads Testers and accept the invite
  4. Generate a short-lived token, then exchange it for a long-lived one:
       curl -s "https://graph.threads.net/access_token?grant_type=th_exchange_token\
&client_secret=APP_SECRET&access_token=SHORT_LIVED"
  5. Read the user id:
       curl -s "https://graph.threads.net/v1.0/me?fields=id,username&access_token=LONG_LIVED"
HELP
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --threads-token)   THREADS_TOKEN="$2"; shift 2 ;;
    --threads-user-id) THREADS_USER_ID="$2"; shift 2 ;;
    --shopee-app-id)   SHOPEE_APP_ID="$2"; shift 2 ;;
    --shopee-secret)   SHOPEE_SECRET="$2"; shift 2 ;;
    --show)            SHOW=true; shift ;;
    -h|--help)         usage ;;
    *) error "Unknown option: $1"; usage ;;
  esac
done

psql_run() { $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow "$@"; }

if ! $COMPOSE exec -T postgres pg_isready -U threadsflow >/dev/null 2>&1; then
  error "Postgres is not running. Start it: cd infra && docker compose up -d"
  exit 1
fi

if $SHOW; then
  psql_run -c "
    SELECT key,
           CASE
             WHEN key = 'threads_creds' THEN
               COALESCE('token ' || left(value->>'token', 8) || '… / user_id ' || (value->>'user_id'), 'unset')
             WHEN key IN ('shopee_app_id','shopee_app_secret') THEN
               COALESCE(key || ' ' || left(value::text,20), 'unset')
             ELSE left(value::text, 40)
           END AS summary
      FROM settings
     WHERE key IN ('threads_creds','shopee_app_id','shopee_app_secret','llm','l4_config','l4_reply')
     ORDER BY key;"
  exit 0
fi

CHANGED=false

if [[ -n "$THREADS_TOKEN" || -n "$THREADS_USER_ID" ]]; then
  if [[ -z "$THREADS_TOKEN" || -z "$THREADS_USER_ID" ]]; then
    error "--threads-token and --threads-user-id must be given together."
    exit 1
  fi

  # Validate before storing: a token that 401s here would otherwise fail
  # silently every 5 minutes inside wf3_publish.
  log "Validating token against graph.threads.net..."
  if command -v curl >/dev/null 2>&1; then
    resp="$(curl -s -m 20 "https://graph.threads.net/v1.0/me?fields=id,username&access_token=${THREADS_TOKEN}" || true)"
    if grep -q '"error"' <<<"$resp"; then
      error "Threads rejected the token:"
      echo "$resp" | head -c 400; echo
      exit 1
    fi
    got_id="$(sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([0-9]*\)".*/\1/p' <<<"$resp")"
    if [[ -n "$got_id" && "$got_id" != "$THREADS_USER_ID" ]]; then
      warn "Token belongs to user id $got_id, but you passed $THREADS_USER_ID."
      warn "Using the id reported by the API ($got_id)."
      THREADS_USER_ID="$got_id"
    fi
    success "Token is valid (user id $THREADS_USER_ID)"
  else
    warn "curl unavailable; storing token without validation."
  fi

  # Pass values as psql variables and cast, so quotes/backslashes are safe.
  psql_run -v tok="$THREADS_TOKEN" -v uid="$THREADS_USER_ID" <<'SQL'
INSERT INTO settings (key, value)
VALUES ('threads_creds',
        jsonb_build_object('token', :'tok', 'user_id', :'uid',
                           'expires_at', (now() + interval '60 days')::text))
ON CONFLICT (key) DO UPDATE
  SET value = settings.value
              || jsonb_build_object('token', :'tok', 'user_id', :'uid',
                                    'expires_at', (now() + interval '60 days')::text);

-- wf7_l4_reply reads the token from l4_reply (settings.l4_reply.threads_token)
INSERT INTO settings (key, value)
VALUES ('l4_reply', jsonb_build_object('threads_token', :'tok', 'enabled', false))
ON CONFLICT (key) DO UPDATE
  SET value = settings.value || jsonb_build_object('threads_token', :'tok');
SQL
  success "threads_creds + l4_reply updated"
  CHANGED=true
fi

if [[ -n "$SHOPEE_APP_ID" || -n "$SHOPEE_SECRET" ]]; then
  if [[ -z "$SHOPEE_APP_ID" || -z "$SHOPEE_SECRET" ]]; then
    error "--shopee-app-id and --shopee-secret must be given together."
    exit 1
  fi
  psql_run -v aid="$SHOPEE_APP_ID" -v sec="$SHOPEE_SECRET" <<'SQL'
INSERT INTO settings (key, value)
VALUES ('shopee_app_id', to_jsonb(:'aid'::text))
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value;

INSERT INTO settings (key, value)
VALUES ('shopee_app_secret', to_jsonb(:'sec'::text))
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value;
SQL
  success "shopee_app_id + shopee_app_secret updated"
  CHANGED=true
fi

if ! $CHANGED; then
  warn "Nothing to do. Use --help for options, or --show to inspect current values."
  exit 0
fi

echo ""
success "Secrets written. Restart the services that read them:"
echo "  cd infra && docker compose up -d"
