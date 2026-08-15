#!/bin/bash
set -euo pipefail

# ─── dgmo Library Release ───────────────────────────────────────────────────
# Builds, runs all checks, then tags and hands the publish to CI, which ships
# @diagrammo/dgmo and @diagrammo/dgmo-standalone over OIDC. Nothing here needs
# an npm credential. Can run standalone or be called by the parent orchestrator.
#
# Expects the version in package.json to be the one being released — it does not
# bump. To bump, tag and ship in one step, use the workspace's
# `scripts/release.sh dgmo X.Y.Z` instead.
#
# Usage:
#   ./release.sh              # build, check, tag, dispatch CI, verify npm
#   ./release.sh --dry-run    # build and check only, no tag, no publish
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
# 🔴 This no longer runs `npm publish` (changed 2026-08-14). Publishing happens
# in `.github/workflows/release.yml`, which authenticates over npm Trusted
# Publishing (OIDC) and needs no stored credential — because npm strips direct
# publish from bypass-2FA tokens in January 2027, and a laptop token was the
# single point of failure for every release in this ecosystem.
#
# The workflow publishes BOTH @diagrammo/dgmo and @diagrammo/dgmo-standalone,
# which share this version. It runs the same checks again on a clean machine;
# the ones above are here to fail fast before anything is tagged.
TAG="v${VERSION}"
NPM_VERSION=$(npm view @diagrammo/dgmo version 2>/dev/null || echo "")

if [ "$VERSION" = "$NPM_VERSION" ]; then
  echo "✓ @diagrammo/dgmo@${VERSION} already published, skipping"
elif [ "$DRY_RUN" = true ]; then
  echo "▶ Dry run — would publish @diagrammo/dgmo@${VERSION} via ${TAG} (skipped)"
else
  # CI publishes from a tag, so there has to be one. In the coordinated app
  # release the version was bumped upstream and never tagged.
  if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    echo "✓ tag ${TAG} exists"
  else
    echo "▶ Tagging ${TAG}"
    git tag "$TAG"
  fi
  git push origin "$TAG"

  echo "▶ Dispatching release.yml at ${TAG}"
  gh workflow run release.yml -R diagrammo/dgmo --ref "$TAG"

  # Poll for the run this dispatch started — `gh workflow run` does not say —
  # matching on the tag so a concurrent release of another version is not
  # mistaken for ours.
  RUN_ID=""
  for _ in $(seq 1 20); do
    RUN_ID=$(gh run list -R diagrammo/dgmo --workflow release.yml --limit 20 \
      --json databaseId,headBranch,event \
      -q "[.[] | select(.headBranch == \"$TAG\" and .event == \"workflow_dispatch\")] | first | .databaseId" \
      2>/dev/null || true)
    [ -n "$RUN_ID" ] && [ "$RUN_ID" != "null" ] && break
    RUN_ID=""
    sleep 3
  done

  if [ -z "$RUN_ID" ]; then
    echo "::error::Dispatched release.yml at ${TAG} but no run appeared within 60s."
    echo "::error::Check: gh run list -R diagrammo/dgmo --workflow release.yml"
    exit 1
  fi

  echo "  run: https://github.com/diagrammo/dgmo/actions/runs/${RUN_ID}"
  if ! gh run watch "$RUN_ID" -R diagrammo/dgmo --exit-status; then
    echo "::error::release.yml failed for ${TAG}."
    echo "::error::Read it: gh run view $RUN_ID -R diagrammo/dgmo --log-failed"
    echo "::error::A publish step that cannot authenticate means the package has no"
    echo "::error::trusted publisher yet. Register it at npmjs.com — the runbook is"
    echo "::error::https://docs.diagrammo.app/infrastructure/npm-trusted-publishers/"
    exit 1
  fi

  # A green run is the deploy log. Ask the registry what it serves.
  for PKG in @diagrammo/dgmo @diagrammo/dgmo-standalone; do
    SERVED=$(npm view "$PKG" version 2>/dev/null || echo "")
    if [ "$SERVED" != "$VERSION" ]; then
      echo "::error::${PKG} serves ${SERVED:-nothing}, expected ${VERSION}."
      exit 1
    fi
    echo "✓ ${PKG}@${VERSION} live on npm"
  done
fi
echo ""

# ─── Output for parent orchestrator ──────────────────────────────────────────
echo "DGMO_VERSION=${VERSION}" >> "${RELEASE_ENV:-/dev/null}"

echo "═══════════════════════════════════════════════"
echo "  @diagrammo/dgmo ${VERSION} done"
echo "═══════════════════════════════════════════════"
