#!/usr/bin/env bash
# ThreadsFlow — One-Click Setup for New VPS
#
# This script sets up ThreadsFlow from scratch on a fresh Debian/Ubuntu VPS.
# It installs Docker, clones the repo, configures the environment, and starts all services.
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/SuperDuperNoob/threadsflow_arena.AI/main/scripts/setup_new_vps.sh | bash
#   OR
#   git clone https://github.com/SuperDuperNoob/threadsflow_arena.AI.git && cd threadsflow_arena.AI
#   ./scripts/setup_new_vps.sh
#
# Requirements:
#   - Fresh Debian 11+ or Ubuntu 20.04+ VPS (2 vCPU, 4GB RAM minimum)
#   - Root or sudo access
#   - Domain name pointed to VPS (or use Cloudflare Tunnel)
#
# What this script does:
#   1. Installs Docker and Docker Compose
#   2. Clones the repository (if not already present)
#   3. Generates secure random passwords
#   4. Creates .env file with defaults
#   5. Starts all Docker services
#   6. Runs database migrations (001-013)
#   7. Seeds techniques, levers, and persona snippets
#   8. Provides next steps for configuration

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${BLUE}[ThreadsFlow]${NC} $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1" >&2; }

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
  error "This script requires root or sudo access."
  error "Please run: sudo $0"
  exit 1
fi

log "Starting ThreadsFlow setup for new VPS..."
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Install Docker and Docker Compose
# ─────────────────────────────────────────────────────────────────────────────

log "Step 1/8: Checking Docker installation..."

if command -v docker &> /dev/null; then
  success "Docker already installed: $(docker --version)"
else
  log "Installing Docker..."
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg lsb-release
  
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/$(lsb_release -is | tr '[:upper:]' '[:lower:]')/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(lsb_release -is | tr '[:upper:]' '[:lower:]') $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
  
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  
  systemctl enable docker
  systemctl start docker
  
  success "Docker installed: $(docker --version)"
fi

# Check Docker Compose
if docker compose version &> /dev/null; then
  success "Docker Compose available: $(docker compose version --short)"
else
  error "Docker Compose not found. Please install docker-compose-plugin."
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Clone repository (if not already present)
# ─────────────────────────────────────────────────────────────────────────────

log "Step 2/8: Setting up repository..."

if [ -f "infra/docker-compose.yml" ]; then
  success "Repository already present"
  log "Pulling latest changes..."
  git pull origin main || warn "Git pull failed, continuing with existing code"
else
  log "Cloning repository..."
  if [ -d "threadsflow_arena.AI" ]; then
    cd threadsflow_arena.AI
  else
    git clone https://github.com/SuperDuperNoob/threadsflow_arena.AI.git
    cd threadsflow_arena.AI
  fi
  success "Repository cloned"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Generate secure passwords and create .env
# ─────────────────────────────────────────────────────────────────────────────

log "Step 3/8: Creating environment configuration..."

cd infra

if [ -f ".env" ]; then
  warn ".env already exists, skipping generation"
  warn "Edit infra/.env manually if you need to change settings"
else
  # Generate secure random values.
  #
  # IMPORTANT: use hex, not base64. base64 emits '/', '+' and '=', which
  #   (a) break the `sed s/…/…/` replacements below (a '/' closes the s-command),
  #       and (b) corrupt DATABASE_URL, since postgres://user:PASS@host parses
  #       '/' and '@' as URL delimiters.
  # hex is [0-9a-f] only, so it is safe in both sed and a URL userinfo field.
  # 32 hex chars = 128 bits of entropy; 48 hex = 192 bits.
  PG_PASSWORD=$(openssl rand -hex 24)
  N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
  IP_SALT=$(openssl rand -hex 16)
  N8N_PASSWORD=$(openssl rand -hex 16)
  KB_PASSWORD=$(openssl rand -hex 16)

  # Copy template and replace placeholders.
  cp .env.example .env

  # Anchor on the key name and use '|' as the delimiter so the value is never
  # re-parsed as part of the sed expression.
  set_env() {
    local key="$1" val="$2"
    if grep -q "^${key}=" .env; then
      sed -i "s|^${key}=.*|${key}=${val}|" .env
    else
      printf '%s=%s\n' "$key" "$val" >> .env
    fi
  }

  set_env PG_PASSWORD       "$PG_PASSWORD"
  set_env N8N_ENCRYPTION_KEY "$N8N_ENCRYPTION_KEY"
  set_env IP_SALT           "$IP_SALT"
  set_env N8N_PASSWORD      "$N8N_PASSWORD"
  set_env KB_PASSWORD       "$KB_PASSWORD"
  # DATABASE_URL embeds the same password and must be kept in sync.
  set_env DATABASE_URL      "postgres://threadsflow:${PG_PASSWORD}@postgres:5432/threadsflow"
  
  success ".env created with secure random passwords"
  
  echo ""
  log "IMPORTANT: Save these credentials securely:"
  echo "  n8n password: $N8N_PASSWORD"
  echo "  KB password:  $KB_PASSWORD"
  echo "  PG password:  $PG_PASSWORD"
  echo ""
  warn "Edit infra/.env to add your domain, LLM API keys, and Threads token"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 4: Start Docker services
# ─────────────────────────────────────────────────────────────────────────────

log "Step 4/8: Starting Docker services..."

docker compose up -d --build

# Wait for postgres to be healthy
log "Waiting for database to be ready..."
for i in {1..30}; do
  if docker compose exec -T postgres pg_isready -U threadsflow &> /dev/null; then
    success "Database is ready"
    break
  fi
  if [ $i -eq 30 ]; then
    error "Database failed to start after 30 seconds"
    exit 1
  fi
  sleep 1
done

# ─────────────────────────────────────────────────────────────────────────────
# Step 5: Run database migrations
# ─────────────────────────────────────────────────────────────────────────────

log "Step 5/8: Running database migrations..."

cd ..

# Core schemas
log "  Initializing core schema..."
docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < db/schema.sql
log "  Initializing techniques schema..."
docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < db/schema_techniques.sql
log "  Initializing KB schema..."
docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < db/schema_kb.sql

# Seeds
log "  Seeding levers and CTA variants..."
docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < db/seed_levers_my.sql
log "  Seeding cold-start techniques..."
docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < db/seed_techniques_my.sql
log "  Seeding mining questions..."
docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < db/mining_questions.sql

# Migrations
log "  Running database migrations..."
for m in db/migrations/*.sql; do
  log "    $(basename "$m")"
  docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < "$m"
  # Record migration in tracking table
  docker compose -f infra/docker-compose.yml exec -T postgres psql -U threadsflow -d threadsflow -c "INSERT INTO schema_migrations (filename) VALUES ('$(basename "$m")') ON CONFLICT (filename) DO NOTHING;"
done

# Additional seeds
log "  Seeding books techniques..."
docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < db/seed_techniques_books.sql
log "  Seeding 2026 Threads techniques..."
docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < db/seed_techniques_2026_threads.sql
log "  Seeding psychology techniques..."
docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < db/seed_techniques_psychology.sql

success "Database initialized with all migrations and seeds"

# ─────────────────────────────────────────────────────────────────────────────
# Step 6: Configure LLM settings
# ─────────────────────────────────────────────────────────────────────────────

log "Step 6/8: Configuring LLM settings..."

./scripts/configure_llm.sh || warn "LLM configuration skipped (edit infra/.env and rerun)"

# ─────────────────────────────────────────────────────────────────────────────
# Step 7: Import n8n workflows
# ─────────────────────────────────────────────────────────────────────────────

log "Step 7/8: Bootstrapping n8n (owner, credential, workflows)..."

# Previously this step only ran populate_workflows.js, which merely rewrites the
# local JSON files — it never talked to n8n, so nothing was actually imported.
# It also probed http://localhost:5678, which can never respond because
# docker-compose.yml publishes no ports (Cloudflare Tunnel only).
# bootstrap_n8n.sh does the real work: creates the owner account, imports the
# Postgres credential as id=PG (which every workflow node already references),
# and imports the workflow definitions via the n8n CLI.
if [ -x "scripts/bootstrap_n8n.sh" ]; then
  ./scripts/bootstrap_n8n.sh || warn "n8n bootstrap incomplete — rerun ./scripts/bootstrap_n8n.sh after fixing the issue"
else
  warn "scripts/bootstrap_n8n.sh missing; import workflows manually in the n8n UI"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 8: Final summary
# ─────────────────────────────────────────────────────────────────────────────

log "Step 8/8: Setup complete!"
echo ""
success "═══════════════════════════════════════════════════════════════"
success "  ThreadsFlow is running!"
success "═══════════════════════════════════════════════════════════════"
echo ""
log "Next steps:"
echo ""
echo "  1. Edit infra/.env to add:"
echo "     - Your domain (N8N_HOST, PUBLIC_REDIRECT_BASE)"
echo "     - LLM API key (LLM_API_KEY)"
echo "     - Threads token (via SQL, see docs/03-setup-runbook.md Step 2.5)"
echo "     - Cloudflare Tunnel token (CF_TUNNEL_TOKEN)"
echo "     - Cloudflare R2 credentials (S3_KEY, S3_SECRET)"
echo ""
echo "  2. Restart services after editing .env:"
echo "     cd infra && docker compose up -d"
echo ""
echo "  3. Access n8n dashboard & Review Queue:"
echo "     - n8n: https://$(grep N8N_HOST infra/.env | cut -d= -f2)"
echo "     - Review Queue: https://kb.$(grep N8N_HOST infra/.env | cut -d= -f2 | cut -d. -f2-)/queue.html"
echo ""
echo "  4. Workflows were imported automatically with the 'Postgres threadsflow'"
echo "     credential already bound. Verify in the n8n UI, or re-run:"
echo "     ./scripts/bootstrap_n8n.sh"
echo ""
echo "  5. Activate workflows once the Threads token is in place:"
echo "     ./scripts/bootstrap_n8n.sh --activate    (wf0, wf6, wf3, wf7)"
echo "     - wf2_generate (after 14 days, when warm-up phase ends)"
echo "     - wf4_evaluate (after first posts are published)"
echo ""
echo "  6. Optional: Import Malaysian datasets from HuggingFace"
echo "     ./scripts/import_malaysian_datasets.sh"
echo ""
log "Documentation: docs/00-START-HERE.md"
log "Runbook: docs/03-setup-runbook.md"
echo ""
success "Setup complete! 🚀"
