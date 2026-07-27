#!/usr/bin/env bash
# Feed every PDF in Books/ through the running Knowledge Base service.
#
# The KB does the full pipeline per file: 3-level dedup -> text extract -> chunk & score
# -> LLM mine -> validate -> embed -> merge into the live library.
# Re-running is safe; identical files are rejected instantly by hash.
#
#   ./scripts/ingest_books.sh https://kb.yourdomain.com
#
# Requires the KB service to be up AND an LLM endpoint configured (LLM_BASE_URL).
# Without an LLM this cannot run — use db/seed_techniques_books.sql instead, which contains
# the same books already mined by hand.

set -euo pipefail
KB="${1:-http://localhost:8082}"
DIR="$(dirname "$0")/../Books"

command -v curl >/dev/null || { echo "curl required"; exit 1; }

echo "Uploading to $KB"
echo "Scanned PDFs will be rejected with a message — run those through ocrmypdf first."
echo

ok=0; dupe=0; fail=0
for f in "$DIR"/*.pdf; do
  name="$(basename "$f")"
  printf '%-55s ' "${name:0:55}"
  resp=$(curl -sS -F "pdfs=@$f" "$KB/api/upload" 2>&1) || { echo "UPLOAD FAILED"; fail=$((fail+1)); continue; }
  case "$resp" in
    *duplicate*) echo "already ingested"; dupe=$((dupe+1)) ;;
    *queued*)    echo "queued";           ok=$((ok+1)) ;;
    *)           echo "$resp";            fail=$((fail+1)) ;;
  esac
  sleep 1   # the worker is serial; no point flooding it
done

echo
echo "queued=$ok  duplicate=$dupe  failed=$fail"
echo "Watch progress in the KB web UI. A 300-page book takes a few minutes."
echo
echo "AFTER it finishes, review before these consume posting slots:"
echo "  psql -c \"SELECT code,type,instruction FROM techniques WHERE n=0 ORDER BY created_at DESC\""
echo "  psql -c \"UPDATE techniques SET enabled=false WHERE code IN ('x','y')\""
