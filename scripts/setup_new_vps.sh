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
  # Generate secure random values
  PG_PASSWORD=$(openssl rand -base64 24 | tr -d '\n')
  N8N_ENCRYPTION_KEY=$(openssl rand -hex 32 | tr -d '\n')
  IP_SALT=$(openssl rand -hex 16 | tr -d '\n')
  N8N_PASSWORD=$(openssl rand -base64 16 | tr -d '\n')
  KB_PASSWORD=$(openssl rand -base64 16 | tr -d '\n')
  
  # Copy template and replace placeholders
  cp .env.example .env
  
  sed -i "s/change_me_long_random/$PG_PASSWORD/" .env
  sed -i "s/generate_with_openssl_rand_hex_32/$N8N_ENCRYPTION_KEY/" .env
  sed -i "s/generate_with_openssl_rand_hex_16/$IP_SALT/" .env
  sed -i "s/^N8N_PASSWORD=change_me$/N8N_PASSWORD=$N8N_PASSWORD/" .env
  sed -i "s/^KB_PASSWORD=change_me$/KB_PASSWORD=$KB_PASSWORD/" .env
  
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
log "  Running migrations 001-013..."
for m in db/migrations/*.sql; do
  log "    $(basename "$m")"
  docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < "$m"
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

log "Step 7/8: Importing n8n workflows..."

# Wait for n8n to be ready
log "  Waiting for n8n to be ready..."
for i in {1..30}; do
  if curl -s http://localhost:5678/healthz &> /dev/null; then
    success "n8n is ready"
    break
  fi
  if [ $i -eq 30 ]; then
    warn "n8n not responding yet, workflows can be imported manually later"
    break
  fi
  sleep 2
done

# Import workflows via n8n API (if available)
if command -v node &> /dev/null && [ -f "scripts/populate_workflows.js" ]; then
  log "  Running workflow importer..."
  node scripts/populate_workflows.js || warn "Workflow import failed, import manually from n8n/workflows/"
else
  warn "Node.js not found or populate_workflows.js missing"
  warn "Import workflows manually: n8n UI → Import from File → select n8n/workflows/*.json"
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
echo "  3. Access n8n dashboard:"
echo "     https://$(grep N8N_HOST infra/.env | cut -d= -f2)"
echo ""
echo "  4. Import workflows (if not auto-imported):"
echo "     n8n UI → Import from File → select n8n/workflows/*.json"
echo "     Assign 'Postgres threadsflow' credential to all Postgres nodes"
echo ""
echo "  5. Activate workflows in this order:"
echo "     - wf0_token_refresh (immediately)"
echo "     - wf6_persona (day 1, for warm-up)"
echo "     - wf3_publish (day 1, publishes queued posts)"
echo "     - wf7_l4_reply (day 1, replies to comments)"
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
