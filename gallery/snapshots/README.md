# Gallery Snapshot Baselines

SVG renders of every gallery fixture, used as the visual regression
baseline for CI. Every parser/renderer change is gated against these
snapshots — any byte diff fails the `gallery-snapshot` CI job.

Renders are pinned to **palette `nord` / theme `light`** so a diff
signals a real change in parser or renderer behavior, not a config
drift.

## Re-baseline after intentional changes

When a parser/renderer change is supposed to alter the output:

```bash
pnpm build                                # CLI must be fresh
pnpm gallery:snapshot:update              # re-render all baselines
git diff --stat gallery/snapshots/        # review the scope
```

Commit the regenerated `.svg` files alongside the code change. The
PR reviewer should be able to tell from the diff whether the visual
change is intended.

## Skipped fixtures

Three fixtures are excluded from the snapshot diff (see `SKIP` map
in `scripts/gallery-snapshot.mjs`):

- `c4.dgmo` and `c4-full.dgmo` — use labeled-arrow syntax that the
  c4 parser doesn't accept (pre-existing fixture bug, tracked
  separately).
- `wordcloud.dgmo` — d3-cloud relies on `HTMLCanvasElement.getContext`
  which jsdom can't provide without the optional `canvas` npm package.

Removing fixtures from the skip list requires fixing the underlying
issue; bare skips rot.

## Local workflow

```bash
pnpm gallery:snapshot                     # verify (CI mode)
pnpm gallery:snapshot:update              # re-baseline
node scripts/gallery-snapshot.mjs --filter=flowchart   # subset
```

Concurrency defaults to CPU count; cap with `--concurrency N` on
shared machines.
