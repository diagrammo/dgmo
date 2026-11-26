### Fixed

- tech-radar: a ring declared `Full Sail as f` now resolves `ring: f`; `alias` and `aka` still work.
- gantt: a plan that ends exactly on a sprint boundary no longer draws an empty sprint after it (a milestone on the boundary still gets its sprint).
- metadata: a comma-separated segment with no `key:` (`label: Paris, France, size: 5`) is dropped with a `W_UNKEYED_METADATA_SEGMENT` warning that names it and says to quote the value, and the pairs after it still apply.
- treemap, icicle, sunburst: an untagged parent takes the neutral fill instead of the tag group's first entry.
- sequence: a note just before a `==` section pushes the divider down, so the gap below the divider is the same with or without the note.

### Changed

- Language reference: the two-colour heat and `region-heat` ramps are documented as a straight fade, and the flowchart node-colour bullet says colour comes from the shape.
