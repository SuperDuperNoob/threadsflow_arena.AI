#!/usr/bin/env bash
# ThreadsFlow — n8n bootstrap: owner account, Postgres credential, workflow import.
#
# This closes the gap between "docker compose up" and "workflows are running".
# Previously this was ~15 minutes of manual clicking in the n8n UI:
#   create owner → create "Postgres threadsflow" credential → import 6 workflow
#   JSONs → re-assign the credential on every Postgres node → activate each one.
#
# The key trick: every Postgres node in n8n/workflows/*.json already references
# credential id "PG". If we import a credential whose id is literally "PG",
# every node in every workflow binds to it automatically — no manual re-assignment.
#
# Usage:
#   ./scripts/bootstrap_n8n.sh              # set up + import (workflows stay inactive)
#   ./scripts/bootstrap_n8n.sh --activate   # also activate the warm-up workflows
#
# Safe to re-run: owner setup, credential import and workflow import all upsert.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RED='\033[0;31m'; NC='\033[0m'
log()     { echo -e "${BLUE}[bootstrap]${NC} $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1" >&2; }

ACTIVATE=false
[[ "${1:-}" == "--activate" ]] && ACTIVATE=true

COMPOSE="docker compose -f infra/docker-compose.yml"
ENV_FILE="infra/.env"

[[ -f "$ENV_FILE" ]] || { error "$ENV_FILE not found. Run scripts/setup_new_vps.sh first."; exit 1; }

read_env() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true; }

PG_PASSWORD="$(read_env PG_PASSWORD)"
N8N_USER="$(read_env N8N_USER)"
N8N_PASSWORD="$(read_env N8N_PASSWORD)"

[[ -n "$PG_PASSWORD" ]] || { error "PG_PASSWORD missing from $ENV_FILE"; exit 1; }

# n8n requires a valid email for the owner account. N8N_USER is often just a
# username ("you"), so synthesise a local address when it is not an email.
OWNER_EMAIL="$N8N_USER"
[[ "$OWNER_EMAIL" == *@* ]] || OWNER_EMAIL="admin@threadsflow.local"
# n8n enforces: >=8 chars, at least one number, at least one uppercase.
OWNER_PASSWORD="$N8N_PASSWORD"
if [[ ${#OWNER_PASSWORD} -lt 8 || ! "$OWNER_PASSWORD" =~ [0-9] || ! "$OWNER_PASSWORD" =~ [A-Z] ]]; then
  OWNER_PASSWORD="Tf$(openssl rand -hex 12)9A"
  warn "N8N_PASSWORD did not meet n8n's complexity rules; generated a new owner password."
fi

# ─────────────────────────────────────────────────────────────────────────────
# 1. Wait for n8n
# ─────────────────────────────────────────────────────────────────────────────
# NOTE: do NOT curl http://localhost:5678 from the host — docker-compose.yml
# publishes no ports (Cloudflare Tunnel only), so that check can never pass.
# We probe from inside the container instead.
log "Waiting for n8n to accept connections..."
ready=false
for _ in $(seq 1 60); do
  if $COMPOSE exec -T n8n node -e \
      'fetch("http://127.0.0.1:5678/healthz").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' \
      >/dev/null 2>&1; then
    ready=true; break
  fi
  sleep 2
done
$ready || { error "n8n did not become ready. Check: $COMPOSE logs n8n"; exit 1; }
success "n8n is up"

# ─────────────────────────────────────────────────────────────────────────────
# 2. Owner account
# ─────────────────────────────────────────────────────────────────────────────
# n8n v1 removed N8N_BASIC_AUTH_* and v2 ignores it entirely; the instance now
# uses built-in user management. Without an owner, the UI shows a setup wizard
# and CLI imports have no user to attach entities to.
log "Ensuring owner account exists..."
$COMPOSE exec -T \
  -e TF_EMAIL="$OWNER_EMAIL" -e TF_PASS="$OWNER_PASSWORD" \
  n8n node -e '
const email = process.env.TF_EMAIL, password = process.env.TF_PASS;
(async () => {
  const base = "http://127.0.0.1:5678";
  const s = await fetch(base + "/rest/settings").then(r => r.json()).catch(() => null);
  const done = s?.data?.userManagement?.showSetupOnFirstLoad === false;
  if (done) { console.log("owner already configured"); return; }
  const res = await fetch(base + "/rest/owner/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "browser-id": "threadsflow-bootstrap" },
    body: JSON.stringify({ email, firstName: "Threads", lastName: "Flow", password }),
  });
  console.log(res.ok ? "owner created" : "owner setup returned " + res.status + " (likely already set up)");
})();' 2>/dev/null || warn "owner setup step skipped"

# ─────────────────────────────────────────────────────────────────────────────
# 3. Postgres credential with the fixed id "PG"
# ─────────────────────────────────────────────────────────────────────────────
log "Importing Postgres credential (id=PG)..."
TMP_CRED="$(mktemp)"
trap 'rm -f "$TMP_CRED"' EXIT
# Field names must match n8n's `postgres` credential type exactly.
cat > "$TMP_CRED" <<JSON
[
  {
    "id": "PG",
    "name": "Postgres threadsflow",
    "type": "postgres",
    "data": {
      "host": "postgres",
      "port": 5432,
      "database": "threadsflow",
      "user": "threadsflow",
      "password": "${PG_PASSWORD}",
      "ssl": "disable",
      "allowUnauthorizedCerts": false,
      "sshTunnel": false,
      "maxConnections": 20
    }
  }
]
JSON

$COMPOSE cp "$TMP_CRED" n8n:/tmp/tf_cred.json >/dev/null
# n8n re-encrypts the plaintext values under N8N_ENCRYPTION_KEY on import.
if $COMPOSE exec -T n8n n8n import:credentials --input=/tmp/tf_cred.json >/dev/null 2>&1; then
  success "credential 'Postgres threadsflow' imported as id=PG"
else
  error "credential import failed. Run manually: $COMPOSE exec n8n n8n import:credentials --input=/tmp/tf_cred.json"
fi
$COMPOSE exec -T n8n rm -f /tmp/tf_cred.json >/dev/null 2>&1 || true

# ─────────────────────────────────────────────────────────────────────────────
# 4. Workflows
# ─────────────────────────────────────────────────────────────────────────────
# Sync the JS brains into the workflow JSON first, so what we import matches
# n8n/code/*.js rather than a stale copy embedded in the workflow file.
if command -v node >/dev/null 2>&1; then
  log "Syncing n8n/code/*.js into workflow JSON..."
  node scripts/populate_workflows.js >/dev/null 2>&1 || warn "populate_workflows.js failed; importing as-is"
fi

log "Importing workflows..."
$COMPOSE exec -T n8n mkdir -p /tmp/tf_wf >/dev/null 2>&1 || true
# wf6_karma_draft is a spec stub waiting on the Meta API — do not import it.
for f in n8n/workflows/*.json; do
  base="$(basename "$f")"
  [[ "$base" == "wf6_karma_draft.json" ]] && continue
  $COMPOSE cp "$f" "n8n:/tmp/tf_wf/$base" >/dev/null
done

if $COMPOSE exec -T n8n n8n import:workflow --separate --input=/tmp/tf_wf >/dev/null 2>&1; then
  success "workflows imported (credentials already bound via id=PG)"
else
  error "workflow import failed. Try: $COMPOSE exec n8n n8n import:workflow --separate --input=/tmp/tf_wf"
fi
$COMPOSE exec -T n8n rm -rf /tmp/tf_wf >/dev/null 2>&1 || true

# ─────────────────────────────────────────────────────────────────────────────
# 5. Optional activation
# ─────────────────────────────────────────────────────────────────────────────
# Deliberately opt-in. Activating wf3_publish before a Threads token exists in
# settings.threads_creds just produces failed executions every 5 minutes.
if $ACTIVATE; then
  log "Activating warm-up workflows..."
  $COMPOSE exec -T n8n node -e '
const { Client } = require("pg");
(async () => {
  const c = new Client({
    host: "postgres", port: 5432, database: "threadsflow",
    user: "threadsflow", password: process.env.DB_POSTGRESDB_PASSWORD,
  });
  await c.connect();
  const want = ["wf0_token_refresh", "wf6_persona", "wf3_publish", "wf7_l4_reply"];
  const r = await c.query(
    `UPDATE n8n.workflow_entity SET active = true WHERE name = ANY($1::text[]) RETURNING name`,
    [want]);
  console.log("activated: " + (r.rows.map(x => x.name).join(", ") || "none matched"));
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });' 2>/dev/null \
    && warn "n8n must be restarted for activation to take effect: $COMPOSE restart n8n" \
    || warn "Could not auto-activate. Activate in the n8n UI instead."
else
  log "Workflows imported but left inactive (use --activate, or toggle them in the UI)."
fi

echo ""
success "═══════════════════════════════════════════════════════════"
success "  n8n bootstrap complete"
success "═══════════════════════════════════════════════════════════"
echo ""
echo "  n8n login:  $OWNER_EMAIL"
echo "  password :  $OWNER_PASSWORD"
echo ""
warn "Save that password — n8n v1+ ignores N8N_BASIC_AUTH_* and this is the only login."
echo ""
echo "Still required before anything posts (human-only steps):"
echo "  1. Threads token  → settings.threads_creds  (Meta OAuth, see docs/03-setup-runbook.md)"
echo "  2. CF_TUNNEL_TOKEN in infra/.env            (Cloudflare Zero Trust dashboard)"
echo "  3. S3_KEY / S3_SECRET in infra/.env         (Cloudflare R2 token screen)"
echo ""
