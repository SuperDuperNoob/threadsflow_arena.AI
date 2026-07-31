#!/usr/bin/env bash
# Import Malaysian persona snippets from HuggingFace datasets
# 
# This script downloads JSONL datasets from HuggingFace and imports them
# into the persona_snippets table for use in persona calibration.
#
# Usage:
#   ./scripts/import_malaysian_datasets.sh [database_url]
#
# Requirements:
#   - curl or wget
#   - Node.js 18+
#   - DATABASE_URL environment variable (or pass as argument)
#
# Datasets imported:
#   - Facebook comments (casual Malay)
#   - IIUM Confessions (reflective Malay)
#   - Manglish/Lowyat (Malaysian English)
#   - Amanz.my (tech reviews)
#   - Malaysian web crawls (various domains)

set -euo pipefail

DATABASE_URL="${1:-${DATABASE_URL:-}}"

if [[ -z "$DATABASE_URL" ]]; then
  echo "Error: DATABASE_URL not set. Pass as argument or set environment variable."
  echo "Usage: $0 postgresql://user:pass@host:port/dbname"
  exit 1
fi

export DATABASE_URL
export PERSONA_DATASET_ACK_NONCOMMERCIAL=1

echo "=== Malaysian Persona Dataset Importer ==="
echo "Database: ${DATABASE_URL%%@*}@***"
echo ""

# Helper function to import a dataset
import_dataset() {
  local name="$1"
  local url="$2"
  local slug="$3"
  local limit="${4:-500}"
  
  echo "📥 Importing $name..."
  echo "   URL: $url"
  echo "   Slug: $slug"
  echo "   Limit: $limit"
  
  node services/kb/bin/persona_dataset.mjs \
    --url "$url" \
    --slug "$slug" \
    --limit "$limit" \
    --usage-allowed \
    || echo "⚠️  Warning: $name import had errors (may be partial)"
  
  echo "✅ $name import complete"
  echo ""
}

# Import datasets from HuggingFace
# Note: These URLs point to raw JSONL files in the HuggingFace repositories

echo "=== Starting imports ==="
echo ""

# 1. Facebook comments (casual Malay)
import_dataset \
  "Facebook Comments (casual Malay)" \
  "https://huggingface.co/datasets/mesolitica/noisy-standard-malay-translation-instructions/resolve/main/facebook-instructions.jsonl" \
  "facebook-casual" \
  800

# 2. IIUM Confessions (reflective Malay)
import_dataset \
  "IIUM Confessions (reflective Malay)" \
  "https://huggingface.co/datasets/mesolitica/noisy-standard-malay-translation-instructions/resolve/main/iium-confession-instructions.jsonl" \
  "iium-reflective" \
  600

# 3. Manglish/Lowyat (Malaysian English)
import_dataset \
  "Manglish/Lowyat (Malaysian English)" \
  "https://huggingface.co/datasets/mesolitica/noisy-standard-malay-translation-instructions/resolve/main/manglish-instructions.jsonl" \
  "lowyat-manglish" \
  500

# 4. Amanz.my (tech reviews)
import_dataset \
  "Amanz.my (tech reviews)" \
  "https://huggingface.co/datasets/mesolitica/crawl-amanz-my/resolve/main/everything.jsonl" \
  "amanz-tech" \
  400

# 5. Malaysian web crawls (various domains)
# Note: malaysia-ai/crawl-my-website has many domains, we'll import a few key ones

import_dataset \
  "Malaysian web crawl - akuislam.com" \
  "https://huggingface.co/datasets/malaysia-ai/crawl-my-website/resolve/main/akuislam.com.jsonl" \
  "akuislam" \
  300

# Add more domains as needed:
# import_dataset "domain-name" "https://huggingface.co/.../domain.jsonl" "slug" 300

echo ""
echo "=== Import Summary ==="
echo ""

# Show statistics
psql "$DATABASE_URL" -c "
SELECT 
  source_domain AS domain,
  COUNT(*) AS snippets,
  AVG(char_count)::int AS avg_chars,
  register
FROM persona_snippets
WHERE enabled AND usage_allowed
GROUP BY source_domain, register
ORDER BY snippets DESC
LIMIT 20;
" || echo "⚠️  Could not show statistics (psql not available)"

echo ""
echo "✅ All imports complete!"
echo ""
echo "Next steps:"
echo "  1. Review imported snippets: SELECT * FROM persona_snippets LIMIT 10;"
echo "  2. Disable low-quality sources: UPDATE persona_sources SET enabled=false WHERE slug='...';"
echo "  3. Test persona generation with new snippets"
echo ""
