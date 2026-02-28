---
name: dgmo-generate
description: Generate a DGMO diagram from a natural language description. Picks the best chart/diagram type automatically.
argument-hint: <description of what to diagram>
allowed-tools: Read, Write, Bash
---

# Generate DGMO Diagram

Generate a `.dgmo` diagram file based on the user's description. Pick the best diagram type for what they're describing.

## Instructions

1. Read the user's description from `$ARGUMENTS`
2. Read the full DGMO language reference at `docs/language-reference.md` (relative to the repo root of the `dgmo` package, or find it via `npm root -g`/`node_modules/@diagrammo/dgmo/docs/language-reference.md`)
3. Choose the best chart/diagram type based on the description:
   - Interactions between services/people → `sequence`
   - Decision trees, processes → `flowchart`
   - Hierarchies, org structures → `org`
   - Database schemas → `er`
   - Class/type hierarchies → `class`
   - System architecture → `c4`
   - Task boards → `kanban`
   - Project roadmaps → `initiative-status`
   - Comparisons, data → `bar`, `line`, `pie`, etc.
   - Flows, allocations → `sankey`
   - Relationships → `arc` or `chord`
   - Timelines → `timeline`
   - Set overlaps → `venn`
   - Priority matrices → `quadrant`
4. Generate valid DGMO syntax following the language reference exactly
5. Write the output to a descriptive `.dgmo` file (e.g., `auth-flow.dgmo`, `db-schema.dgmo`)

## After generating

Check if `dgmo` CLI is available:
```bash
command -v dgmo 2>/dev/null
```

If **not installed**, tell the user how to install it:
- `brew install diagrammo/dgmo/dgmo` (macOS, recommended)
- `npm install -g @diagrammo/dgmo`
- Or run without installing: `npx @diagrammo/dgmo <file>.dgmo`

If available (or after install), offer to render:
```bash
dgmo <file>.dgmo -o <file>.svg
dgmo <file>.dgmo -o url          # shareable link
```

## Common mistakes to avoid

- Don't use `#` for comments — use `//`
- Don't use `async` keyword — use `~>` for async messages
- Don't use `end` in sequence blocks — indentation closes blocks
- Don't use hex colors in section headers — use named colors
- Always include `chart:` directive when the type can't be inferred from content
