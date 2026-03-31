# Story 48.2: Dagre.js Integration

Status: review

## Story

As a developer building structural diagram support for dgmo,
I want a layout function that takes a `ParsedGraph` and returns positioned nodes and routed edges using Dagre's hierarchical layout algorithm,
so that flowcharts and future structural diagrams get automatic, professional graph layout.

## Acceptance Criteria

1. `layoutGraph()` produces valid positions for all nodes (x, y, width, height)
2. Edge routes avoid node overlaps (edge waypoints returned)
3. `direction: TB` and `direction: LR` produce correct layouts (maps to Dagre `rankdir`)
4. Groups cluster their member nodes together (Dagre compound graph / subgraphs)
5. Layout handles cycles (back-edges) gracefully — no crash, reasonable routing
6. Unit tests with simple graph inputs verify positions are reasonable
7. `pnpm build && pnpm typecheck` passes
8. No regression on existing chart types

## Tasks / Subtasks

- [x] Task 1: Add Dagre dependency (AC: 7)
  - [x] 1.1: Run `pnpm add @dagrejs/dagre` (community fork, more actively maintained)
  - [x] 1.2: Run `pnpm add -D @types/dagre` for TypeScript types (if available; otherwise add local type declarations)
  - [x] 1.3: Verify `pnpm build` still passes with new dependency
- [x] Task 2: Define `LayoutResult` types in `src/graph/layout.ts` (AC: 1, 2)
  - [x] 2.1: Define `LayoutNode` interface: `id`, `x`, `y`, `width`, `height`, `label`, `shape` (original GraphNode data + position)
  - [x] 2.2: Define `LayoutEdge` interface: `source`, `target`, `points` (array of `{x, y}` waypoints), `label?`, `color?`
  - [x] 2.3: Define `LayoutGroup` interface: `id`, `label`, `color?`, `x`, `y`, `width`, `height` (bounding box around member nodes)
  - [x] 2.4: Define `LayoutResult` interface: `nodes`, `edges`, `groups`, `width`, `height` (total diagram dimensions)
- [x] Task 3: Implement `layoutGraph()` function (AC: 1, 2, 3, 4, 5)
  - [x] 3.1: Create Dagre graph: `new dagre.graphlib.Graph({ compound: true })` for subgraph support
  - [x] 3.2: Set graph options: `rankdir` from `direction` (TB→TB, LR→LR), `nodesep: 50`, `ranksep: 60`, `edgesep: 20`
  - [x] 3.3: Compute node dimensions based on shape and label text length (approximate: `width = max(120, labelLength * 9 + 40)`, `height = 50` for most shapes, `height = 60` for decision diamonds)
  - [x] 3.4: Add nodes to Dagre graph with computed dimensions
  - [x] 3.5: If groups exist, create parent nodes for each group and set parent relationships
  - [x] 3.6: Add edges to Dagre graph
  - [x] 3.7: Run `dagre.layout(graph)`
  - [x] 3.8: Extract positioned nodes from Dagre output
  - [x] 3.9: Extract edge waypoints from Dagre output (array of `{x, y}` points)
  - [x] 3.10: Compute group bounding boxes from member node positions + padding
  - [x] 3.11: Compute total diagram width/height from all positioned elements
  - [x] 3.12: Return `LayoutResult`
- [x] Task 4: Export from `src/index.ts` (AC: 7)
  - [x] 4.1: Export `layoutGraph` function and `LayoutResult`, `LayoutNode`, `LayoutEdge`, `LayoutGroup` types
- [x] Task 5: Write tests in `tests/graph-layout.test.ts` (AC: 1, 2, 3, 4, 5, 6)
  - [x] 5.1: Test simple linear graph (3 nodes, 2 edges) — verify all nodes have positions, edges have waypoints
  - [x] 5.2: Test direction TB — verify y-coordinates increase top-to-bottom
  - [x] 5.3: Test direction LR — verify x-coordinates increase left-to-right
  - [x] 5.4: Test graph with groups — verify member nodes cluster together
  - [x] 5.5: Test graph with back-edge (cycle) — verify no crash, reasonable layout
  - [x] 5.6: Test graph with decision branching — verify branch nodes at different positions
  - [x] 5.7: Run `pnpm test` — all tests pass
- [x] Task 6: Final verification (AC: 7, 8)
  - [x] 6.1: Run `pnpm build && pnpm typecheck && pnpm test`

## Dev Notes

### Dagre API Reference

```typescript
import dagre from '@dagrejs/dagre';

// Create graph
const g = new dagre.graphlib.Graph({ compound: true });
g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 60 });
g.setDefaultEdgeLabel(() => ({}));

// Add nodes
g.setNode('id', { label: 'text', width: 120, height: 50 });

// Add edges
g.setEdge('source', 'target', { label: 'text' });

// Compound graphs (groups/subgraphs)
g.setNode('group-id', { label: 'Group', clusterLabelPos: 'top' });
g.setParent('child-node-id', 'group-id');

// Run layout
dagre.layout(g);

// Read positions
const node = g.node('id'); // { x, y, width, height }
const edge = g.edge('source', 'target'); // { points: [{x,y}, ...] }
```

### Node Dimension Heuristics

Since we don't have DOM text measurement in Node.js, approximate:
- Base width: `max(120, label.length * 9 + 40)` — 9px per character + 40px padding
- Base height: 50px for all shapes except decision (60px — diamond is taller)
- Document shape: same as process (wavy bottom doesn't affect bounding box)
- Subroutine: add 10px width for double border visual

### Codebase Patterns

- File location: `src/graph/layout.ts`
- Imports from: `src/graph/types.ts` (ParsedGraph, GraphNode, etc.)
- Exported from: `src/index.ts`
- Uses `FONT_FAMILY` from `src/fonts.ts` only if text measurement is needed (optional for v1)
- No palette dependency — layout is color-agnostic

### Package Choice: @dagrejs/dagre vs dagre

Prefer `@dagrejs/dagre` — it's the community fork that's more actively maintained. If types are missing, use `@types/dagre` which covers the same API surface. If neither has types, create a minimal `src/graph/dagre.d.ts` declaration.

### References

- [Source: docs/epics/epic-48.structural-diagrams-flowchart.md#Story 48.2]
- [Source: src/d3.ts — renderD3ForExport pattern for SVG dimensions]
- [Source: src/sequence/renderer.ts — complex multi-element layout precedent]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

No issues encountered. `@dagrejs/dagre` v2.0.4 installed cleanly, `@types/dagre` v0.7.53 provides full type coverage.

### Completion Notes List

- Installed `@dagrejs/dagre@2.0.4` (runtime) + `@types/dagre@0.7.53` (dev)
- Created `src/graph/layout.ts` with 4 exported types (`LayoutNode`, `LayoutEdge`, `LayoutGroup`, `LayoutResult`) + `layoutGraph()` function
- `layoutGraph()` handles: compound graphs (groups), direction TB/LR via `rankdir`, node dimension heuristics, cycle/back-edge tolerance, group bounding box computation, total diagram dimensions
- Node dimension heuristics: `width = max(120, label.length * 9 + 40)`, `height = 50` (60 for decision), subroutine +10px width
- Group bounding box: computed from member node positions with 20px padding
- Created `tests/graph-layout.test.ts` with 11 tests: linear graph, TB direction, LR direction, groups, cycles, branching, edge metadata preservation, node metadata preservation, label-based width, decision height, empty graph
- Exported `layoutGraph` + all layout types from `src/index.ts`
- `pnpm build` — clean (dist/index.d.ts includes 9 layout references)
- `pnpm typecheck` — clean
- `pnpm test` — 201 tests pass, 0 regressions

### File List

- `src/graph/layout.ts` — NEW — Dagre layout integration
- `src/index.ts` — MODIFIED — added layout exports
- `tests/graph-layout.test.ts` — NEW — layout tests (11 tests)
- `package.json` — MODIFIED — added @dagrejs/dagre dependency
- `pnpm-lock.yaml` — MODIFIED — lockfile updated
