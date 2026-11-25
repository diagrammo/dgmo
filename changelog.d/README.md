# changelog.d

One file per change. Never edit `CHANGELOG.md` for an unreleased change:
two landings on it the same day force a rebase, and a rebase voids the verify
receipt (diagrammo/diagrammo#2340).

- Name the file after the issue or a slug: `2340-changelog-fragments.md`.
- Write Keep a Changelog markdown: `### Added`, `### Changed`, `### Deprecated`,
  `### Removed`, `### Fixed` or `### Security`, then the entries under it.
  Text before the first heading files under Changed.
- `scripts/release.sh dgmo X.Y.Z` in the workspace root runs
  `scripts/changelog-assemble.mjs`, which folds every fragment into
  `CHANGELOG.md` under `## [X.Y.Z] - <date>`, in file-name order, and deletes
  them. This README stays.
