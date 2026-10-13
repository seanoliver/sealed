#!/usr/bin/env bash
# Usage: migration-drift.sh <migrations dir> < production versions (one per line)
set -euo pipefail

repo=$(find "$1" -maxdepth 1 -name "*.sql" -exec basename {} \; | cut -d_ -f1 | sort)
remote=$(grep -v '^$' | sort || true)
missing=$(comm -23 <(echo "$repo") <(echo "$remote") | grep -v '^$' || true)
extra=$(comm -13 <(echo "$repo") <(echo "$remote") | grep -v '^$' || true)

if [ -n "$missing" ]; then
  echo "::error::Not applied to production: ${missing//$'\n'/ }"
fi
if [ -n "$extra" ]; then
  echo "::error::Applied to production but not in the repository: ${extra//$'\n'/ }"
fi
if [ -n "$missing" ] || [ -n "$extra" ]; then
  exit 1
fi
echo "Production has exactly the repository's migrations."
