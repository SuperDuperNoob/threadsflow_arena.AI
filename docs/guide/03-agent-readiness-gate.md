# Agent Readiness Gate

This gate is the preflight logic an agent should run before starting/activating a deployment. It verifies required human-sourced secrets are already present; it must **not** try to obtain them automatically.

Run it twice:

1. **Before first `docker compose up`:** validates `infra/.env` and stops early if external values are missing.
2. **After DB init and `scripts/set_secrets.sh`:** validates DB-held Threads secrets before `./scripts/bootstrap_n8n.sh --activate`.

Optional integrations are warnings by default. Set `REQUIRE_SHOPEE=true` or `REQUIRE_PERPLEXITY=true` to make them hard failures.

## Copy-paste preflight script

```bash
#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-infra/.env}"
COMPOSE="${COMPOSE:-docker compose -f infra/docker-compose.yml}"
ALLOW_EMPTY_LLM_KEY="${ALLOW_EMPTY_LLM_KEY:-false}"
REQUIRE_L4="${REQUIRE_L4:-true}"
REQUIRE_SHOPEE="${REQUIRE_SHOPEE:-false}"
REQUIRE_PERPLEXITY="${REQUIRE_PERPLEXITY:-false}"

errors=()
warnings=()

fail() { errors+=("$1"); }
warn() { warnings+=("$1"); }

if [[ ! -f "$ENV_FILE" ]]; then
  fail "Missing $ENV_FILE. Run setup or copy infra/.env.example to infra/.env, then fill human-sourced values from docs/guide/01-credential-sourcing.md."
fi

read_env() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || { echo ""; return; }
  grep -m1 "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true
}

is_placeholder() {
  local v="$1"
  [[ -z "$v" ]] && return 0
  [[ "$v" == *"change_me"* ]] && return 0
  [[ "$v" == *"generate_with"* ]] && return 0
  [[ "$v" == *"paste_from"* ]] && return 0
  [[ "$v" == *"yourdomain.com"* ]] && return 0
  [[ "$v" == *"<accountid>"* ]] && return 0
  [[ "$v" == *"YOUR"* ]] && return 0
  return 1
}

need_env() {
  local key="$1" platform="$2" row="$3"
  local v="$(read_env "$key")"
  if is_placeholder "$v"; then
    fail "$key missing/placeholder in $ENV_FILE — source from $platform ($row)."
  fi
}

need_url_env() {
  local key="$1" platform="$2" row="$3"
  local v="$(read_env "$key")"
  if is_placeholder "$v" || [[ ! "$v" =~ ^https?:// ]]; then
    fail "$key must be a non-placeholder http(s) URL in $ENV_FILE — source from $platform ($row)."
  fi
}

# Tier A generated values must exist before containers can run.
need_env PG_PASSWORD "agent-generated Tier A secret" "docs/guide/01-credential-sourcing.md#code-derived-credential-inventory"
need_env N8N_ENCRYPTION_KEY "agent-generated Tier A secret" "docs/guide/01-credential-sourcing.md#code-derived-credential-inventory"
need_env N8N_USER "agent-generated/operator n8n owner" "docs/guide/01-credential-sourcing.md#code-derived-credential-inventory"
need_env N8N_PASSWORD "agent-generated n8n owner password" "docs/guide/01-credential-sourcing.md#code-derived-credential-inventory"
need_env KB_PASSWORD "agent-generated KB password" "docs/guide/01-credential-sourcing.md#code-derived-credential-inventory"
need_env IP_SALT "agent-generated redirector salt" "docs/guide/01-credential-sourcing.md#code-derived-credential-inventory"

# Human/platform sourced required values.
need_env N8N_HOST "domain/Cloudflare DNS" "docs/guide/01-credential-sourcing.md#cred-domain"
need_url_env PUBLIC_REDIRECT_BASE "domain/Cloudflare DNS" "docs/guide/01-credential-sourcing.md#cred-domain"
need_env CF_TUNNEL_TOKEN "Cloudflare Zero Trust Tunnel" "docs/guide/01-credential-sourcing.md#cred-cloudflare-tunnel"
need_url_env S3_ENDPOINT "Cloudflare R2" "docs/guide/01-credential-sourcing.md#cred-r2"
need_env S3_BUCKET "Cloudflare R2" "docs/guide/01-credential-sourcing.md#cred-r2"
need_env S3_KEY "Cloudflare R2" "docs/guide/01-credential-sourcing.md#cred-r2"
need_env S3_SECRET "Cloudflare R2" "docs/guide/01-credential-sourcing.md#cred-r2"
need_url_env PUBLIC_IMAGE_BASE "Cloudflare R2 public bucket/custom domain" "docs/guide/01-credential-sourcing.md#cred-r2"
need_url_env LLM_BASE_URL "OpenAI-compatible LLM provider" "docs/guide/01-credential-sourcing.md#cred-llm"
need_env LLM_MODEL_WRITE "OpenAI-compatible LLM provider" "docs/guide/01-credential-sourcing.md#cred-llm"
need_env LLM_MODEL_EDIT "OpenAI-compatible LLM provider" "docs/guide/01-credential-sourcing.md#cred-llm"
need_env LLM_MODEL_EMBED "OpenAI-compatible LLM provider" "docs/guide/01-credential-sourcing.md#cred-llm"
need_env LLM_MODEL_MINE "OpenAI-compatible LLM provider" "docs/guide/01-credential-sourcing.md#cred-llm"

if [[ "$ALLOW_EMPTY_LLM_KEY" != "true" ]]; then
  need_env LLM_API_KEY "OpenAI-compatible LLM provider (set ALLOW_EMPTY_LLM_KEY=true only for a verified no-auth endpoint)" "docs/guide/01-credential-sourcing.md#cred-llm"
fi

if [[ "$(read_env IMAGE_BACKEND)" != "s3" ]]; then
  warn "IMAGE_BACKEND is not 's3'. Local media mode is possible, but production Threads media needs a public HTTPS URL and R2 is the documented path."
fi

# Optional integrations.
if [[ "$REQUIRE_SHOPEE" == "true" ]]; then
  need_env SHOPEE_API_APP_ID "Shopee Affiliate Open API" "docs/guide/01-credential-sourcing.md#cred-shopee"
  need_env SHOPEE_API_SECRET "Shopee Affiliate Open API" "docs/guide/01-credential-sourcing.md#cred-shopee"
else
  [[ -z "$(read_env SHOPEE_API_APP_ID)" || -z "$(read_env SHOPEE_API_SECRET)" ]] && \
    warn "Shopee Open API keys are not set. Product intake and click tracking still work; conversion attribution waits."
fi

if [[ "$REQUIRE_PERPLEXITY" == "true" ]]; then
  need_env PERPLEXITY_API_KEY "Perplexity API" "docs/guide/01-credential-sourcing.md#cred-perplexity"
else
  [[ -z "$(read_env PERPLEXITY_API_KEY)" ]] && \
    warn "PERPLEXITY_API_KEY is not set. Persona topic refresh will use seeded topics only."
fi

# DB-held required secrets. This block can run only after Postgres is up and migrations/seeds exist.
if $COMPOSE exec -T postgres pg_isready -U threadsflow >/dev/null 2>&1; then
  threads_ok="$($COMPOSE exec -T postgres psql -U threadsflow -d threadsflow -Atc \
    "SELECT COALESCE((value->>'token') <> '' AND (value->>'user_id') <> '', false) FROM settings WHERE key='threads_creds';" 2>/dev/null || true)"
  if [[ "$threads_ok" != "t" ]]; then
    fail "Threads token/user id missing from settings. Run: ./scripts/set_secrets.sh --threads-token TOKEN --threads-user-id ID — source from docs/guide/01-credential-sourcing.md#cred-threads."
  fi

  if [[ "$REQUIRE_L4" == "true" ]]; then
    l4_token_ok="$($COMPOSE exec -T postgres psql -U threadsflow -d threadsflow -Atc \
      "SELECT COALESCE((value->>'threads_token') <> '', false) FROM settings WHERE key='l4_reply';" 2>/dev/null || true)"
    if [[ "$l4_token_ok" != "t" ]]; then
      fail "L4 is slated for activation but settings.l4_reply.threads_token is missing. Current wf7_l4_reply reads this key; patch it after set_secrets.sh or set REQUIRE_L4=false."
    fi
  fi
else
  warn "Postgres is not running; DB-held Threads secrets could not be verified. Do not run bootstrap_n8n.sh --activate until this gate passes after DB init."
fi

if (( ${#warnings[@]} )); then
  echo "Warnings:"
  printf '  - %s\n' "${warnings[@]}"
fi

if (( ${#errors[@]} )); then
  echo "Preflight FAILED. Missing/invalid required inputs:"
  printf '  - %s\n' "${errors[@]}"
  echo
  echo "Stop now. Do not attempt to create identity-, consent-, billing-, or approval-gated credentials automatically."
  exit 1
fi

echo "Preflight PASSED for required deployment inputs."
```

## Stop conditions

The agent must stop immediately if any required value is missing. It may generate Tier A secrets locally, but it must not attempt to:

- create/buy a VPS or domain,
- create Cloudflare accounts or bypass Cloudflare UI ownership checks,
- create Meta apps, log into Threads, accept tester invites, or click OAuth consent,
- apply for Shopee Affiliate/Open API approval,
- create paid LLM/Perplexity accounts.

Those actions cross identity, consent, billing, or platform-trust boundaries and belong to the human operator.
