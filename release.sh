#!/bin/bash
set -euo pipefail

# ─── dgmo Library Release ───────────────────────────────────────────────────
# Builds, runs all checks, and publishes to npm.
# Can run standalone or be called by the parent orchestrator.
#
# Usage:
#   ./release.sh              # build, check, publish
#   ./release.sh --dry-run    # build and check only, skip npm publish
# ─────────────────────────────────────────────────────────────────────────────

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
  esac
done

VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*: *"\(.*\)".*/\1/')

echo "═══════════════════════════════════════════════"
echo "  @diagrammo/dgmo Release ${VERSION}"
echo "═══════════════════════════════════════════════"
echo ""

# ─── Build ───────────────────────────────────────────────────────────────────
echo "▶ Building..."
pnpm build
echo "✓ Build complete"
echo ""

# ─── Static Analysis ────────────────────────────────────────────────────────
echo "▶ Running checks..."
pnpm typecheck
pnpm lint
pnpm test
pnpm check:all
echo "✓ All checks passed"
echo ""

# ─── Publish ─────────────────────────────────────────────────────────────────
NPM_VERSION=$(npm view @diagrammo/dgmo version 2>/dev/null || echo "")

if [ "$VERSION" = "$NPM_VERSION" ]; then
  echo "✓ @diagrammo/dgmo@${VERSION} already published, skipping"
elif [ "$DRY_RUN" = true ]; then
  echo "▶ Dry run — would publish @diagrammo/dgmo@${VERSION} (skipped)"
else
  echo "▶ Publishing @diagrammo/dgmo@${VERSION} to npm..."
  npm publish
  echo "✓ @diagrammo/dgmo@${VERSION} published"
fi
echo ""

# ─── Output for parent orchestrator ──────────────────────────────────────────
echo "DGMO_VERSION=${VERSION}" >> "${RELEASE_ENV:-/dev/null}"

echo "═══════════════════════════════════════════════"
echo "  @diagrammo/dgmo ${VERSION} done"
echo "═══════════════════════════════════════════════"
