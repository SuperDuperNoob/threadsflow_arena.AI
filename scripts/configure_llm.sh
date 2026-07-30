#!/usr/bin/env bash
# Configure the shared ThreadsFlow LLM endpoint.
#
# Examples:
#   ./scripts/configure_llm.sh \
#     --base-url https://9router.archxry.space/v1 \
#     --api-key sk-... \
#     --write-model gemini-2.5-flash \
#     --edit-model gpt-4.1-mini \
#     --embed-model text-embedding-3-small \
#     --mine-model gemini-2.5-pro
#
#   ./scripts/configure_llm.sh --local-9router
#
# It updates infra/.env (if present) and the Postgres settings.llm row (if the DB is running).

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

read_env_var() {
  local key="$1" file="infra/.env"
  [[ -f "$file" ]] || { echo ''; return 0; }
  grep -m1 "^${key}=" "$file" | cut -d= -f2- || true
}

# Use infra/.env as the starting point when it exists, so changing one field does not reset others.
BASE_URL="${LLM_BASE_URL:-$(read_env_var LLM_BASE_URL)}"
BASE_URL="${BASE_URL:-https://9router.archxry.space/v1}"
ENV_API_KEY="${LLM_API_KEY:-$(read_env_var LLM_API_KEY)}"
API_KEY="__KEEP__"
WRITE_MODEL="${LLM_MODEL_WRITE:-$(read_env_var LLM_MODEL_WRITE)}"
WRITE_MODEL="${WRITE_MODEL:-gemini-2.5-flash}"
EDIT_MODEL="${LLM_MODEL_EDIT:-$(read_env_var LLM_MODEL_EDIT)}"
EDIT_MODEL="${EDIT_MODEL:-gpt-4.1-mini}"
EMBED_MODEL="${LLM_MODEL_EMBED:-$(read_env_var LLM_MODEL_EMBED)}"
EMBED_MODEL="${EMBED_MODEL:-text-embedding-3-small}"
MINE_MODEL="${LLM_MODEL_MINE:-$(read_env_var LLM_MODEL_MINE)}"
MINE_MODEL="${MINE_MODEL:-gemini-2.5-pro}"

usage() {
  cat <<'HELP'
Configure the shared ThreadsFlow LLM endpoint.

Examples:
  ./scripts/configure_llm.sh --hosted-9router --api-key sk-...
  ./scripts/configure_llm.sh --local-9router
  ./scripts/configure_llm.sh \
    --base-url https://api.openai.com/v1 \
    --api-key sk-... \
    --write-model gpt-4.1-mini \
    --edit-model gpt-4.1-mini \
    --embed-model text-embedding-3-small \
    --mine-model gpt-4.1

Options:
  --base-url URL       OpenAI-compatible /v1 base URL
  --api-key KEY        Save or replace API key
  --clear-api-key      Remove saved API key
  --write-model NAME   Model for first draft posts
  --edit-model NAME    Model for human-pass rewrite
  --embed-model NAME   Model for embeddings/similarity
  --mine-model NAME    Model for PDF mining/enrichment
  --hosted-9router     Use https://9router.archxry.space/v1
  --local-9router      Use http://host.docker.internal:9000/v1
HELP
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="${2:?missing value}"; shift 2 ;;
    --api-key) API_KEY="${2:-}"; shift 2 ;;
    --clear-api-key) API_KEY=""; shift ;;
    --write-model|--model-write) WRITE_MODEL="${2:?missing value}"; shift 2 ;;
    --edit-model|--model-edit) EDIT_MODEL="${2:?missing value}"; shift 2 ;;
    --embed-model|--model-embed) EMBED_MODEL="${2:?missing value}"; shift 2 ;;
    --mine-model|--model-mine|--model) MINE_MODEL="${2:?missing value}"; shift 2 ;;
    --local-9router) BASE_URL="http://host.docker.internal:9000/v1"; shift ;;
    --hosted-9router) BASE_URL="https://9router.archxry.space/v1"; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

case "$BASE_URL" in
  http://*|https://*) ;;
  *) echo "--base-url must start with http:// or https://" >&2; exit 1 ;;
esac

upsert_env() {
  local key="$1" value="$2" file="infra/.env"
  [[ -f "$file" ]] || return 0
  if grep -q "^${key}=" "$file"; then
    # Use | delimiter so URLs are safe.
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

if [[ -f infra/.env ]]; then
  upsert_env LLM_BASE_URL "$BASE_URL"
  [[ "$API_KEY" != "__KEEP__" ]] && upsert_env LLM_API_KEY "$API_KEY"
  upsert_env LLM_MODEL_WRITE "$WRITE_MODEL"
  upsert_env LLM_MODEL_EDIT "$EDIT_MODEL"
  upsert_env LLM_MODEL_EMBED "$EMBED_MODEL"
  upsert_env LLM_MODEL_MINE "$MINE_MODEL"
  echo "Updated infra/.env"
else
  echo "infra/.env not found; DB settings will still be updated if Postgres is running."
fi

if docker compose -f infra/docker-compose.yml exec -T postgres pg_isready -U threadsflow >/dev/null 2>&1; then
  # Preserve existing DB api_key unless caller explicitly provides/clears one.
  if [[ "$API_KEY" == "__KEEP__" ]]; then
    ENV_API_KEY_ESCAPED="$(printf "%s" "$ENV_API_KEY" | sed "s/'/''/g")"
    API_KEY_SQL="COALESCE(NULLIF((SELECT value->>'api_key' FROM settings WHERE key='llm'),''),'${ENV_API_KEY_ESCAPED}')"
  else
    API_KEY_SQL="'$(printf "%s" "$API_KEY" | sed "s/'/''/g")'"
  fi

  docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow <<SQL
INSERT INTO settings (key, value) VALUES
('llm', jsonb_build_object(
  'base_url', '$(printf "%s" "$BASE_URL" | sed "s/'/''/g")',
  'api_key', $API_KEY_SQL,
  'model_write', '$(printf "%s" "$WRITE_MODEL" | sed "s/'/''/g")',
  'model_edit', '$(printf "%s" "$EDIT_MODEL" | sed "s/'/''/g")',
  'model_embed', '$(printf "%s" "$EMBED_MODEL" | sed "s/'/''/g")',
  'model_mine', '$(printf "%s" "$MINE_MODEL" | sed "s/'/''/g")'
))
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;
SQL
  echo "Updated Postgres settings.llm"
else
  echo "Postgres is not running; start the stack and rerun this script, or use /settings.html."
fi

echo "LLM config done. If containers are already running and you changed infra/.env, run: docker compose -f infra/docker-compose.yml up -d"
