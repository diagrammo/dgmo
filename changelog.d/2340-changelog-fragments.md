### Changed

- **Changelog entries are fragments in `changelog.d/`
  (diagrammo/diagrammo#2340).** Each change adds one file; the release folds
  them into `CHANGELOG.md` under the new version and deletes them, so two
  landings on the same day no longer conflict on `CHANGELOG.md`.
