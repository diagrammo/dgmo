#!/usr/bin/env bash
# migrate-flags.sh — rewrite retired DGMO flag names in .dgmo files in a directory.
#
# Renames:
#   no-label-name    → no-name
#   no-label-value   → no-value
#   no-label-percent → no-percent
#   no-labels        → no-name
#   hide-descriptions → no-descriptions
#
# Usage: ./migrate-flags.sh <directory>
#
# Walks <directory> recursively and rewrites .dgmo files in place.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <directory>" >&2
  exit 2
fi

DIR="$1"
if [ ! -d "$DIR" ]; then
  echo "error: '$DIR' is not a directory" >&2
  exit 1
fi

# macOS sed needs an empty arg after -i; GNU sed does not. Detect once.
if sed --version >/dev/null 2>&1; then
  SED_INPLACE=(-i)
else
  SED_INPLACE=(-i '')
fi

count=0
# We rewrite all matches including those inside comments — review the diff before committing.
# Strategy: token boundaries are line-start, line-end, or whitespace.
# Each substitution loops until idempotent (`:loop ... t loop`) so adjacent flags on
# the same line don't get skipped by the consumed-trailing-whitespace problem.
while IFS= read -r -d '' file; do
  sed "${SED_INPLACE[@]}" -E \
    -e ':a' -e 's/(^|[[:space:]])no-label-percent([[:space:]]|$)/\1no-percent\2/g; ta' \
    -e ':b' -e 's/(^|[[:space:]])no-label-value([[:space:]]|$)/\1no-value\2/g; tb' \
    -e ':c' -e 's/(^|[[:space:]])no-label-name([[:space:]]|$)/\1no-name\2/g; tc' \
    -e ':d' -e 's/(^|[[:space:]])no-labels([[:space:]]|$)/\1no-name\2/g; td' \
    -e ':e' -e 's/(^|[[:space:]])hide-descriptions([[:space:]]|$)/\1no-descriptions\2/g; te' \
    "$file"
  count=$((count + 1))
done < <(find "$DIR" -type f -name '*.dgmo' -print0)

echo "migrated $count .dgmo file(s) in $DIR"
