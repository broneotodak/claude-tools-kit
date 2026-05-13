#!/usr/bin/env bash
#
# lint-no-hardcoded-agents.sh — refactor v2 step 7 regression guard.
#
# Fails CI if any source file uses 2+ distinct NACA agent names as object
# keys or array/Set elements — the structural smell of a hardcoded WATCH /
# AGENT_LABELS / PROJECT_DEPLOY_MAP-style list. Legitimate single references
# (e.g. `from_agent === 'dev-agent'`) are NOT flagged.
#
# Spec: broneotodak/naca docs/spec/agent-registry-schema-v1.md §4.3.
#
# USAGE
#   ./scripts/lint-no-hardcoded-agents.sh [path ...]
#
# Defaults to CWD. Exits 0 on clean, 1 on hit.
#
# ALLOWLIST (intentional exceptions):
#   - claude-tools-kit/tools/registry-meta-backfill.js   migration helper
#   - **/test/** **/tests/** **/__tests__/**             test fixtures
#   - **/docs/** **/spec/** **/*.md                      documentation
#   - **/node_modules/** **/.git/** **/dist/** **/build/**
#   - this script itself
#
# INLINE EXEMPTION MARKERS:
#   - `// lint:hardcoded-agents-ok`         exempt the current line
#   - `// lint:hardcoded-agents-ok-begin`   exempt a multi-line block
#     ...                                   (e.g. an object literal that
#   - `// lint:hardcoded-agents-ok-end`     legitimately names agents)
#
# Use markers sparingly — they record an architectural decision that this
# particular list is intentionally hardcoded and cannot trivially move to
# agent_registry. Include a brief justification in the marker comment.
#
set -eo pipefail

ROOT="${1:-.}"

# Curated agent names in agent_registry as of 2026-05-13. Adding agents to
# the registry doesn't require updating this list — the goal is to catch new
# hardcoded lists of the agents the refactor-v2 arc just migrated.
NAMES=(
  siti dev-agent planner-agent reviewer-agent reviewer
  twin-ingest claw-mac supervisor naca-backend
  toolsmith toolsmith-agent timekeeper timekeeper-agent
  verifier-agent daily-checkup backup-sync
  siti-router siti-ingest poster-agent deployer-agent
  pr-decision-dispatcher twin-autoreply naca-monitor
  browser-agent publisher-agent
)
ALT=$(IFS='|'; echo "${NAMES[*]}")

# Build a regex that matches a quoted agent name AS the leading token on a
# line (modulo whitespace) followed by a `:` (object key) or `,` (array/set
# element). Captures the agent name.
STRUCTURAL_RE="^[[:space:]]*['\"](${ALT})['\"][[:space:]]*[:,]"

files=$(
  find "$ROOT" \
    \( -path '*/node_modules' -o -path '*/.git' -o -path '*/dist' \
       -o -path '*/build' -o -path '*/.next' -o -path '*/.netlify' \
       -o -path '*/docs' -o -path '*/spec' \
       -o -path '*/test' -o -path '*/tests' -o -path '*/__tests__' \) -prune \
    -o -type f \( -name '*.js' -o -name '*.ts' -o -name '*.mjs' -o -name '*.cjs' \) \
    -not -name 'registry-meta-backfill.js' \
    -not -name 'lint-no-hardcoded-agents.sh' \
    -print
)

# For each file, count distinct agent names appearing in structural positions.
# Print "filepath:names" if ≥ 2 distinct names.
hits=""
while IFS= read -r file; do
  [ -z "$file" ] && continue
  # Slurp the whole file, strip noise that shouldn't be scanned:
  #   1. Range exemption: drop everything between `lint:hardcoded-agents-ok-begin`
  #      and `lint:hardcoded-agents-ok-end` markers (inclusive)
  #   2. Single-line exemption: drop any line carrying `lint:hardcoded-agents-ok`
  #   3. /* ... */ block comments
  #   4. // line comments
  # Then match agent names in list-element / object-key positions:
  #   preceded by [ , ( or start-of-line (with optional whitespace),
  #   followed by , : ] ) } (lookahead, not consumed).
  hit=$(perl -0777 -ne '
    s{^[^\n]*lint:hardcoded-agents-ok-begin[^\n]*\n.*?^[^\n]*lint:hardcoded-agents-ok-end[^\n]*\n?}{}gms;
    s{^[^\n]*lint:hardcoded-agents-ok[^\n]*\n?}{}gm;
    s{/\*.*?\*/}{}gs;
    s{//[^\n]*}{}g;
    my %seen; my @order; my $first_line;
    while (/(?:^|[\[,(])\s*[\x27"]('"$ALT"')[\x27"]\s*(?=[,:\]\)\}])/gm) {
      my $n = $1;
      if (!$seen{$n}) {
        $seen{$n} = 1; push @order, $n;
        if (!defined $first_line) {
          my $prefix = substr($_, 0, pos());
          $first_line = ($prefix =~ tr/\n//) + 1;
        }
      }
    }
    print "$first_line:" . join(",", @order) if @order >= 2;
  ' "$file") || true
  if [ -n "$hit" ]; then
    line="${hit%%:*}"
    names="${hit#*:}"
    hits="${hits}${file}:${line}: literal lists [${names}]\n"
  fi
done <<< "$files"

if [ -n "$hits" ]; then
  echo "❌ Hardcoded NACA agent list detected. Move to agent_registry per docs/spec/agent-registry-schema-v1.md."
  echo ""
  printf "$hits"
  echo ""
  echo "If this is an intentional single-source allowlist (e.g. a new"
  echo "registry backfill helper), exempt it in scripts/lint-no-hardcoded-agents.sh."
  exit 1
fi

echo "✓ No hardcoded NACA agent lists found in $ROOT"
exit 0
