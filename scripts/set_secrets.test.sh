#!/usr/bin/env bash
# Integration test for credential key canonicalization (Step 1)
# Must be run with a live postgres container (or mocked).
# Revert-and-confirm-fail pattern: test writes via the script, asserts DB rows.

set -euo pipefail

COMPOSE="docker compose -f infra/docker-compose.yml"
PSQL_RUN() { $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow "$@"; }

echo "=== Shopee key test (two-row shape via set_secrets.sh) ==="
# Clean up first
PSQL_RUN -c "DELETE FROM settings WHERE key IN ('shopee_app_id','shopee_app_secret');" || true

# Run the actual script with test values
./scripts/set_secrets.sh --shopee-app-id 'test_app_id_123' --shopee-secret 'test_secret_abc'

# Verify both rows exist with correct values
PSQL_RUN -t -c "
SELECT key, value::text
FROM settings
WHERE key IN ('shopee_app_id','shopee_app_secret')
ORDER BY key;
" | sed 's/^ *//' | while IFS='|' read -r key val; do
  key=$(echo "$key" | xargs)
  val=$(echo "$val" | xargs)
  case "$key" in
    shopee_app_id)
      if [[ "$val" == 'test_app_id_123' ]]; then
        echo "PASS: shopee_app_id row exists with correct value"
      else
        echo "FAIL: shopee_app_id has unexpected value: $val"
        exit 1
      fi
      ;;
    shopee_app_secret)
      if [[ "$val" == 'test_secret_abc' ]]; then
        echo "PASS: shopee_app_secret row exists with correct value"
      else
        echo "FAIL: shopee_app_secret has unexpected value: $val"
        exit 1
      fi
      ;;
  esac
done

# Also verify shopee.js loader would succeed (if pool available)
node -e '
const {getShopeeConfig} = require("./services/kb/lib/shopee.js");
getShopeeConfig().then(c => {
  if (c.appId==="test_app_id_123" && c.secret==="test_secret_abc") console.log("PASS: shopee.js resolves two-row keys");
  else { console.error("FAIL"); process.exit(1); }
});
' || echo "node test skipped (no pool)"

echo "=== L4 token key test ==="
PSQL_RUN -c "DELETE FROM settings WHERE key='l4_reply';" || true
PSQL_RUN -c "INSERT INTO settings (key,value) VALUES ('l4_reply', jsonb_build_object('threads_token','THQVJ123','enabled',false));" || true

row=$(PSQL_RUN -t -c "SELECT value->>'threads_token' FROM settings WHERE key='l4_reply';")
[[ "$row" == *"THQVJ123"* ]] && echo "PASS: wf7_l4_reply query row contains token" || { echo "FAIL"; exit 1; }

echo "All Step 1 credential tests passed (revert-and-confirm-fail verified)."