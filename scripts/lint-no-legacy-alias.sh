#!/usr/bin/env bash
# ============================================================
# lint-no-legacy-alias.sh (TD-18)
# ============================================================
#
# CI guardrail: fail the build if any tracked `.dgmo` (or
# embedded-`.dgmo`-string) file still contains legacy alias
# syntax. Pre-1.0 hard-break — see Universal Alias Syntax
# tech-spec, F8 / Phase 8.
#
# Patterns rejected:
#   1. Bare tag shorthand:           ^\s*tag\s+\S+\s+[a-z]{1,4}\s*$
#   2. Venn explicit `alias` keyword: \balias\s+[A-Za-z]
#   3. Sequence `aka`:                \baka\b   (already removed —
#      kept here as defense-in-depth so a regression is loud)
#
# Limits:
#   - Walks only `.dgmo` files at the dgmo repo level (CI runs
#     this from `dgmo/` cwd). Other repos run their own copies.
#   - Excludes the `node_modules`, `dist`, and `gallery/snapshots`
#     directories.
#
# Exit codes:
#   0 — no legacy patterns found
#   1 — at least one match (printed with file:line:line-content)

set -euo pipefail

# Resolve search roots that exist at the cwd. CI runs in `dgmo/`,
# so these are relative to that.
ROOTS=()
for d in gallery/fixtures tests test-fixtures src; do
  [[ -d "$d" ]] && ROOTS+=("$d")
done

# If nothing matches there's nothing to lint — exit cleanly.
if [[ ${#ROOTS[@]} -eq 0 ]]; then
  echo "lint-no-legacy-alias: no roots found, skipping"
  exit 0
fi

EXIT_CODE=0

# Pattern 1: bare tag shorthand `tag Name x` (1–4 lowercase chars).
# Must NOT have `as` between Name and the alias token.
echo "→ scanning for legacy 'tag <Name> <alias>' (bare shorthand)…"
while IFS= read -r -d '' file; do
  # Use grep with line-numbered output. `-E` for extended regex.
  if matches=$(grep -nE '^[[:space:]]*tag[[:space:]]+[^[:space:]]+[[:space:]]+[a-z]{1,4}[[:space:]]*$' "$file" 2>/dev/null || true); then
    if [[ -n "$matches" ]]; then
      echo "$file: legacy bare tag shorthand"
      echo "$matches" | sed 's/^/  /'
      EXIT_CODE=1
    fi
  fi
done < <(find "${ROOTS[@]}" -type f -name '*.dgmo' -print0 2>/dev/null)

# Pattern 2: venn `alias` keyword.
echo "→ scanning for legacy 'alias <token>' venn keyword…"
while IFS= read -r -d '' file; do
  if matches=$(grep -nE '\balias[[:space:]]+[A-Za-z]' "$file" 2>/dev/null || true); then
    if [[ -n "$matches" ]]; then
      echo "$file: legacy 'alias' keyword"
      echo "$matches" | sed 's/^/  /'
      EXIT_CODE=1
    fi
  fi
done < <(find "${ROOTS[@]}" -type f -name '*.dgmo' -print0 2>/dev/null)

# Pattern 3: defense-in-depth — `aka` keyword should never appear
# in fixtures (already removed by Universal Name Handling).
echo "→ scanning for stale 'aka' keyword…"
while IFS= read -r -d '' file; do
  if matches=$(grep -nE '\baka\b' "$file" 2>/dev/null || true); then
    if [[ -n "$matches" ]]; then
      echo "$file: stale 'aka' keyword"
      echo "$matches" | sed 's/^/  /'
      EXIT_CODE=1
    fi
  fi
done < <(find "${ROOTS[@]}" -type f -name '*.dgmo' -print0 2>/dev/null)

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "lint-no-legacy-alias: clean"
fi

exit $EXIT_CODE
