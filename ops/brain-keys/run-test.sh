#!/bin/bash
# Runs the migration AND its tests in one transaction that always rolls back (the last statement raises). Nothing is changed in the live database.
set -euo pipefail
D=$(cd "$(dirname "$0")" && pwd); T=$(mktemp)
cat "$D/01-vault-shadow.sql" "$D/01-vault-shadow.test.sql" > "$T"
node ~/bin/neo-brain-sql.mjs -f "$T" 2>&1 | sed 's/\\n/\n/g' | grep -E "RESULTS|^ok|^FAIL|ERROR" | sed 's/.*RESULTS/RESULTS/' | cut -c1-200
rm -f "$T"
