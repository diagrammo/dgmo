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
    cp "$DIST_DIR"/*.d.ts "$DIST_DIR"/*.d.cts "$BASELINE_DIR/"
    echo "api-baseline: re-baselined from $DIST_DIR/"
    ls "$BASELINE_DIR" | wc -l | xargs printf "  %s files captured\n"
    ;;

  check)
    if [ ! -d "$BASELINE_DIR" ]; then
      echo "error: $BASELINE_DIR/ not found. Run 'pnpm check:api:update' to initialize." >&2
      exit 2
    fi
    # diff -q lists only the file names that differ; -ru shows content.
    # We capture both for a useful failure message.
    DIFF_OUTPUT=$(diff -q "$BASELINE_DIR" "$DIST_DIR" 2>/dev/null | grep -E '\.d\.(ts|cts)$' || true)
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
