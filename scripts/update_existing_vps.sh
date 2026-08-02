#!/usr/bin/env bash
# ThreadsFlow — One-Click Update for Existing VPS
#
# This script updates an already-running ThreadsFlow installation to the latest version.
# It pulls the latest code, runs new migrations (tracked in schema_migrations table),
# seeds new data, and restarts services.
#
# Usage:
#   cd /path/to/threadsflow_arena.AI
#   ./scripts/update_existing_vps.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${BLUE}[ThreadsFlow Update]${NC} $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1" >&2; }

# Check if we're in the right directory
if [ ! -f "infra/docker-compose.yml" ]; then
  error "infra/docker-compose.yml not found. Please run this script from the repository root."
  exit 1
fi

# Check if Docker services are running
if ! docker compose -f infra/docker-compose.yml ps | grep -q "Up"; then
  error "Docker services are not running. Start them first: cd infra && docker compose up -d"
  exit 1
fi

log "Starting ThreadsFlow update..."
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Pull latest code
# ─────────────────────────────────────────────────────────────────────────────

log "Step 1/5: Pulling latest code..."

if git rev-parse --git-dir > /dev/null 2>&1; then
  CURRENT_BRANCH=$(git branch --show-current)
  log "  Current branch: $CURRENT_BRANCH"

  git fetch origin
  git pull origin "$CURRENT_BRANCH" || {
    warn "Git pull failed. You may have local changes."
    warn "Continuing with existing code..."
  }
  success "Code updated"
else
  warn "Not a Git repository. Skipping code update."
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Check and run new migrations (using schema_migrations tracking table)
# ─────────────────────────────────────────────────────────────────────────────

log "Step 2/5: Running new migrations..."

# Wait for postgres to be ready
log "  Checking database connection..."
if ! docker compose -f infra/docker-compose.yml exec -T postgres pg_isready -U threadsflow &> /dev/null; then
  error "Database is not ready. Please start services first: cd infra && docker compose up -d"
  exit 1
fi

# Get list of already applied migrations from tracking table
log "  Checking applied migrations..."
APPLIED_MIGRATIONS=$(docker compose -f infra/docker-compose.yml exec -T postgres psql -U threadsflow -d threadsflow -t -c "SELECT filename FROM schema_migrations ORDER BY filename" | sed 's/^[[:space:]]*//; /^$/d')

# Find migrations that haven't been applied yet
MIGRATIONS_TO_RUN=()
for m in db/migrations/*.sql; do
  BASENAME=$(basename "$m")
  if ! echo "$APPLIED_MIGRATIONS" | grep -q "^${BASENAME}$"; then
    MIGRATIONS_TO_RUN+=("$BASENAME")
  fi
done

if [ ${#MIGRATIONS_TO_RUN[@]} -eq 0 ]; then
  success "All migrations already applied"
else
  log "  Running ${#MIGRATIONS_TO_RUN[@]} new migration(s)..."
  for m in "${MIGRATIONS_TO_RUN[@]}"; do
    log "    $m"
    docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < "db/migrations/$m"
    # Record the migration in tracking table
    docker compose -f infra/docker-compose.yml exec -T postgres psql -U threadsflow -d threadsflow -c "INSERT INTO schema_migrations (filename) VALUES ('$m') ON CONFLICT (filename) DO NOTHING;"
  done
  success "Migrations complete"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Seed new data
# ─────────────────────────────────────────────────────────────────────────────

log "Step 3/5: Seeding new data..."

# Check if psychology techniques are seeded
if ! docker compose -f infra/docker-compose.yml exec -T postgres psql -U threadsflow -d threadsflow -t -c "SELECT 1 FROM technique_sources WHERE title LIKE 'Books/ (Psychology%'" | grep -q 1; then
  log "  Seeding psychology techniques..."
  docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < db/seed_techniques_psychology.sql
  success "Psychology techniques seeded"
else
  success "Psychology techniques already seeded"
fi

# Check if 2026 techniques are seeded
if ! docker compose -f infra/docker-compose.yml exec -T postgres psql -U threadsflow -d threadsflow -t -c "SELECT 1 FROM technique_sources WHERE title LIKE 'Books/ (2026 Threads%'" | grep -q 1; then
  log "  Seeding 2026 Threads techniques..."
  docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < db/seed_techniques_2026_threads.sql
  success "2026 Threads techniques seeded"
else
  success "2026 Threads techniques already seeded"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 4: Restart services (rebuild to pick up code changes)
# ─────────────────────────────────────────────────────────────────────────────

log "Step 4/5: Restarting Docker services..."

cd infra
docker compose up -d --build
success "Services restarted"
cd ..

# ─────────────────────────────────────────────────────────────────────────────
# Step 5: Final summary
# ─────────────────────────────────────────────────────────────────────────────

log "Step 5/5: Update complete!"
echo ""
success "═══════════════════════════════════════════════════════════════"
success "  ThreadsFlow updated successfully!"
success "═══════════════════════════════════════════════════════════════"
echo ""
log "New features available:"
echo ""

echo "  ✓ Human-in-the-Loop Review Queue"
echo "    Approve, reject, or edit generated posts before publication"
echo "    URL: https://kb.<your-domain>/queue.html"
echo ""

echo "  ✓ Psychology techniques (17 new)"
echo "    Cialdini, Voss, Dhawan, Handley, Carnegie, Bacon"
echo ""

echo "  ✓ Malaysian persona snippets (177 new)"
echo "    Facebook, IIUM, Amanz, Twitter, Lowyat, Mamak, Parenting, Commute, Work"
echo ""

echo "  ✓ Time-of-day topic affinity"
echo "    Morning→commute, Afternoon→petua, Evening→food/family"
echo ""

log "Next steps:"
echo ""

echo "  1. Import new workflows into n8n:"
echo "     - wf7_l4_reply.json (L4 reply loop)"
echo "     - wf6_persona.json (updated with psychology + time-of-day)"
echo ""

echo "  2. Activate wf7_l4_reply in n8n:"
echo "     - Assign 'Postgres threadsflow' credential to all Postgres nodes"
echo "     - Activate the workflow"
echo ""

echo "  3. (Optional) Import more Malaysian datasets:"
echo "     ./scripts/import_malaysian_datasets.sh"
echo ""

echo "  4. Monitor logs:"
echo "     docker compose -f infra/docker-compose.yml logs -f n8n"
echo ""

log "Documentation: docs/11-quick-start.md"
echo ""
success "Update complete! 🚀"
