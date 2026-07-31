#!/usr/bin/env bash
# Refresh persona_topics via Perplexity Sonar.
#
# Runs inside the kb service (which has perplexity API + DB access).
#
# Usage:
#   ./scripts/refresh_persona_topics.sh            # live run
#   DRY_RUN=1 ./scripts/refresh_persona_topics.sh  # preview what would be inserted
#   ./scripts/refresh_persona_topics.sh --count 12 # override topic count
#
# Requires PERPLEXITY_API_KEY to be set in infra/.env.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

COUNT=8
DRY_RUN="${DRY_RUN:-0}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --count) COUNT="${2:?missing value}"; shift 2;;
    --dry-run) DRY_RUN=1; shift;;
    -h|--help)
      echo "Usage: $0 [--count N] [--dry-run]"; exit 0;;
    *) echo "Unknown option: $1" >&2; exit 1;;
  esac
done

if ! docker compose -f infra/docker-compose.yml exec -T postgres pg_isready -U threadsflow >/dev/null 2>&1; then
  echo "Error: postgres container is not running. Start the stack first: docker compose -f infra/docker-compose.yml up -d" >&2
  exit 1
fi

# Run topic_refresh.mjs inside the kb service.
DRY_RUN="$DRY_RUN" TOPIC_REFRESH_COUNT="$COUNT" \
  docker compose -f infra/docker-compose.yml exec -T kb \
  sh -lc 'cd /app && DRY_RUN="$DRY_RUN" TOPIC_REFRESH_COUNT="$TOPIC_REFRESH_COUNT" node bin/topic_refresh.mjs'
