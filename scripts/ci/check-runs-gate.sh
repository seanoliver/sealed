#!/usr/bin/env bash
# Usage: check-runs-gate.sh <check name>... < check-runs.json
set -euo pipefail

GITHUB_ACTIONS_APP_ID=15368
runs=$(cat)
failed=0
for check in "$@"; do
  result=$(jq -r --arg name "$check" --argjson app "$GITHUB_ACTIONS_APP_ID" '
    [.check_runs[] | select(.name == $name and .app.id == $app)] as $runs
    | if ($runs | length) == 0 then "missing"
      elif any($runs[]; .status != "completed") then "in progress"
      else ($runs | sort_by(.completed_at) | last | .conclusion)
      end' <<<"$runs")
  if [ "$result" != "success" ]; then
    echo "::error::CI check '$check' is '$result'"
    failed=1
  fi
done
exit "$failed"
