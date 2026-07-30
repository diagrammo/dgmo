#!/usr/bin/env bash
# Public API surface diff tool — Epic 105 Story 105.NEW, Epic 106 Story 106.2.
#
# Compares the freshly-built dist/*.d.ts and dist/*.d.cts against the
# checked-in api-baseline/ snapshot. Fails if any public type declaration
# has changed.
#
# Usage:
#   pnpm check:api          → fails on any change
#   pnpm check:api:update   → re-baselines (use after intentional API changes)
#
# Why: dgmo's published .d.ts files are consumed by 7 downstream packages
# (remark-dgmo, astro-dgmo, docusaurus-plugin-dgmo, fumadocs-dgmo,
# obsidian-dgmo, dgmo-mcp, diagrammo-app). Strictness changes can silently
# leak as breaking type changes; this tripwire catches them at PR time.

set -e

MODE="${1:-check}"
BASELINE_DIR="api-baseline"
DIST_DIR="dist"

# The public surface is the named subpath entries only. ESM code-splitting
# (tsup `splitting: true` on index/block/advanced) also emits internal shared
# dts chunks with content-hashed names (e.g. themes-1-CuKpeH.d.ts). Those are
# implementation detail, not public API, and their hash shifts whenever an
# unrelated type in the chunk moves — baselining them would make this tripwire
# fire on every such edit. Restrict the snapshot to the known entries.
ENTRIES="index block advanced editor highlight pert auto element cloud-reference"

# Print the list of entry dts files (both .d.ts and .d.cts) that exist in $1.
entry_dts_files() {
  local dir="$1" e
  for e in $ENTRIES; do
    [ -f "$dir/$e.d.ts" ] && echo "$e.d.ts"
    [ -f "$dir/$e.d.cts" ] && echo "$e.d.cts"
  done
}

if [ ! -d "$DIST_DIR" ]; then
  echo "error: $DIST_DIR/ not found. Run 'pnpm build' first." >&2
  exit 2
fi

case "$MODE" in
  update)
    if [ ! -d "$BASELINE_DIR" ]; then
      mkdir -p "$BASELINE_DIR"
    fi
    # Wipe and recapture to handle removed files cleanly
    rm -f "$BASELINE_DIR"/*.d.ts "$BASELINE_DIR"/*.d.cts
    entry_dts_files "$DIST_DIR" | while read -r f; do
      cp "$DIST_DIR/$f" "$BASELINE_DIR/$f"
    done
    echo "api-baseline: re-baselined from $DIST_DIR/ (entry surfaces only)"
    ls "$BASELINE_DIR" | wc -l | xargs printf "  %s files captured\n"
    ;;

  check)
    if [ ! -d "$BASELINE_DIR" ]; then
      echo "error: $BASELINE_DIR/ not found. Run 'pnpm check:api:update' to initialize." >&2
      exit 2
    fi
    # Compare only the entry dts surfaces (see ENTRIES rationale above).
    # A missing entry file on either side is itself a reportable change.
    DIFF_OUTPUT=""
    for f in $(entry_dts_files "$DIST_DIR" && entry_dts_files "$BASELINE_DIR" | sort -u); do
      if [ ! -f "$DIST_DIR/$f" ]; then
        DIFF_OUTPUT="${DIFF_OUTPUT}Only in $BASELINE_DIR: $f"$'\n'
      elif [ ! -f "$BASELINE_DIR/$f" ]; then
        DIFF_OUTPUT="${DIFF_OUTPUT}Only in $DIST_DIR: $f"$'\n'
      elif ! diff -q "$BASELINE_DIR/$f" "$DIST_DIR/$f" >/dev/null 2>&1; then
        DIFF_OUTPUT="${DIFF_OUTPUT}Files $BASELINE_DIR/$f and $DIST_DIR/$f differ"$'\n'
      fi
    done
    DIFF_OUTPUT=$(printf '%s' "$DIFF_OUTPUT" | sort -u | sed '/^$/d')
    if [ -z "$DIFF_OUTPUT" ]; then
      echo "api-baseline: $DIST_DIR/ matches baseline (no public type changes)"
      exit 0
    fi
    echo "api-baseline: public type surface CHANGED"
    echo ""
    echo "$DIFF_OUTPUT"
    echo ""
    echo "If this change is intentional (new public API, type widening, etc.),"
    echo "re-baseline with: pnpm check:api:update"
    echo ""
    echo "If unintentional (a strictness fix leaked into the published API),"
    echo "revert the type change and re-fix it locally without touching the surface."
    exit 1
    ;;

  *)
    echo "usage: $0 [check|update]" >&2
    exit 2
    ;;
esac
