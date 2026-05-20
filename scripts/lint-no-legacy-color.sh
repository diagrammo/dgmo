#!/usr/bin/env bash
# ============================================================
# lint-no-legacy-color.sh
# ============================================================
#
# CI guardrail: fail the build if any tracked source / docs /
# fixture / example file still contains the legacy `(color)`
# parens-suffix syntax for one of the 11 recognized palette
# colors. Pre-1.0 hard-break — see Simplify Color Syntax
# tech-spec, Task 0b / AC-34.
#
# Pattern rejected: `(red|orange|yellow|green|blue|purple|
#   teal|cyan|gray|black|white)` enclosed in parens.
#
# Limits:
#   - Walks tracked content roots relative to the dgmo repo cwd.
#   - Excludes node_modules, dist, __snapshots__, the migration
#     script itself, and language-spec sections that explicitly
#     demonstrate the old form (allow-list at top of script).
#
# Exit codes:
#   0 — no legacy patterns found
#   1 — at least one match (printed with file:line:line-content)

set -euo pipefail

# Pattern: parens enclosing exactly one of the 11 palette colors,
# possibly with surrounding whitespace inside the parens.
COLOR_PATTERN='\((red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white)\)'

# Files / paths to allow-list — these legitimately demonstrate the
# old syntax for migration purposes.
ALLOWLIST=(
  'scripts/lint-no-legacy-color.sh'           # this script
  'scripts/migrate-color-syntax.mjs'          # internal migrator
  'tests/migrate-color-syntax.test.mjs'       # migrator test fixtures
)

is_allowlisted() {
  local file="$1"
  for pat in "${ALLOWLIST[@]}"; do
    [[ "$file" == *"$pat"* ]] && return 0
  done
  return 1
}

# Resolve search roots that exist at the cwd. CI runs in `dgmo/`.
ROOTS=()
for d in src tests test-fixtures gallery scripts docs README.md API.md AGENTS.md; do
  [[ -e "$d" ]] && ROOTS+=("$d")
done

if [[ ${#ROOTS[@]} -eq 0 ]]; then
  echo "lint-no-legacy-color: no roots found, skipping"
  exit 0
fi

EXIT_CODE=0

echo "→ scanning for legacy '(color)' parens-suffix on 11 palette colors…"
while IFS= read -r -d '' file; do
  is_allowlisted "$file" && continue
  # Skip binary files and irrelevant extensions
  case "$file" in
    *.snap|*.png|*.svg|*.jpg|*.pdf) continue ;;
    */__snapshots__/*) continue ;;
    */node_modules/*) continue ;;
    */dist/*) continue ;;
  esac
  if matches=$(grep -nE "$COLOR_PATTERN" "$file" 2>/dev/null || true); then
    if [[ -n "$matches" ]]; then
      echo "$file: legacy (color) parens-suffix"
      echo "$matches" | sed 's/^/  /'
      EXIT_CODE=1
    fi
  fi
done < <(find "${ROOTS[@]}" -type f \
  \( -name '*.dgmo' -o -name '*.ts' -o -name '*.tsx' -o -name '*.js' \
     -o -name '*.mjs' -o -name '*.md' -o -name '*.mdx' \) -print0 2>/dev/null)

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "lint-no-legacy-color: clean"
fi

exit $EXIT_CODE
