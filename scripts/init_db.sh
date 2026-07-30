#!/usr/bin/env bash
# Initialize the ThreadsFlow PostgreSQL database container with core schemas, migrations, and seeds.

set -euo pipefail

# Ensure we are in the repository root directory
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "Checking if postgres container is running and healthy..."
if ! docker compose -f infra/docker-compose.yml exec -T postgres pg_isready -U threadsflow >/dev/null 2>&1; then
  echo "Error: postgres container is not running or not healthy."
  echo "Please start the stack first by running: docker compose -f infra/docker-compose.yml up -d"
  exit 1
fi

echo "Initializing core schema..."
docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < db/schema.sql

echo "Initializing copywriting techniques schema..."
docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < db/schema_techniques.sql

echo "Initializing Knowledge Base schema..."
docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < db/schema_kb.sql

echo "Seeding levers, CTA text pool, and banned phrases (Malaysian Malay)..."
docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < db/seed_levers_my.sql

echo "Seeding cold-start Malay copywriting techniques..."
docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < db/seed_techniques_my.sql

echo "Seeding technique library extraction questions..."
docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < db/mining_questions.sql

echo "Running migrations in order..."
# Retrieve list of migrations from the db/migrations directory
migrations=$(ls db/migrations/*.sql | sort)
for m in $migrations; do
  echo "  Running migration: $(basename "$m")"
  docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < "$m"
done

echo "Seeding PDF books copywriting techniques..."
docker compose -f infra/docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U threadsflow -d threadsflow < db/seed_techniques_books.sql

echo "Applying LLM settings from infra/.env (if present)..."
./scripts/configure_llm.sh

echo "Database initialization complete! 🚀"
