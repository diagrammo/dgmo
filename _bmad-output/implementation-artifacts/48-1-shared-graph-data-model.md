# Story 48.1: Shared Graph Data Model

Status: review

## Story

As a developer building structural diagram support for dgmo,
I want a shared graph data model (`ParsedGraph`, `GraphNode`, `GraphEdge`, `GraphGroup`),
so that flowcharts, state machines, ER diagrams, class diagrams, and C4 diagrams can all parse into a common representation that feeds Dagre layout and SVG rendering.

## Acceptance Criteria

1. `ParsedGraph` can represent all flowchart constructs (6 shapes, labeled edges, groups, direction)
2. `GraphShape` type union is extensible for future diagram types (state, entity, class, etc.)
3. All types exported from package public API (`src/index.ts`)
4. No runtime code — types only (this is a pure type definition story)
5. `pnpm build && pnpm typecheck` passes with new types
6. Existing 22 chart types remain unaffected

## Tasks / Subtasks

- [x] Task 1: Create `src/graph/types.ts` with all type definitions (AC: 1, 2)
  - [x] 1.1: Define `GraphShape` type union — 6 flowchart shapes: `terminal`, `process`, `decision`, `io`, `subroutine`, `document`
  - [x] 1.2: Define `GraphNode` interface — `id`, `label`, `shape`, `color?`, `group?`, `lineNumber`
  - [x] 1.3: Define `GraphEdge` interface — `source`, `target`, `label?`, `color?`, `lineNumber`
  - [x] 1.4: Define `GraphGroup` interface — `id`, `label`, `color?`, `nodeIds`, `lineNumber`
  - [x] 1.5: Define `GraphDirection` type — `'TB' | 'LR'`
  - [x] 1.6: Define `ParsedGraph` interface — `type`, `title?`, `direction`, `nodes`, `edges`, `groups?`, `error?`
- [x] Task 2: Export types from `src/index.ts` (AC: 3)
  - [x] 2.1: Add export block for `ParsedGraph`, `GraphNode`, `GraphEdge`, `GraphGroup`, `GraphShape`, `GraphDirection` from `./graph/types`
- [x] Task 3: Verify build and typecheck (AC: 5, 6)
  - [x] 3.1: Run `pnpm build` — confirm no errors, `dist/` output includes new types in `.d.ts` files
  - [x] 3.2: Run `pnpm typecheck` — confirm no type errors
  - [x] 3.3: Run `pnpm test` — confirm all existing tests pass (no regression)
- [x] Task 4: Write type validation tests (AC: 1, 2, 4)
  - [x] 4.1: Create `tests/graph-types.test.ts`
  - [x] 4.2: Write compile-time type assertion tests verifying:
    - A `ParsedGraph` with all 6 shape types can be constructed
    - `GraphShape` accepts all 6 values and rejects invalid strings
    - `GraphNode` requires `id`, `label`, `shape`, `lineNumber` (non-optional)
    - `GraphEdge` requires `source`, `target`, `lineNumber` (non-optional)
    - `GraphGroup` requires `id`, `label`, `nodeIds`, `lineNumber` (non-optional)
    - `ParsedGraph` requires `type`, `direction`, `nodes`, `edges` (non-optional)
    - Optional fields (`color`, `label`, `group`, `title`, `groups`, `error`) can be omitted
  - [x] 4.3: Run `pnpm test` — all new tests pass

## Dev Notes

### Codebase Conventions (MUST FOLLOW)

**Color fields:** Use `color?: string` (optional undefined), NOT `color: string | null`. This matches the modern pattern used in `ChartDataPoint`, `EChartsDataPoint`, `ParsedScatterPoint`, and `ParsedFunction`. Colors should be pre-resolved at parse time via `resolveColor()` from `src/colors.ts`.

**Line numbers:** Every element MUST have `lineNumber: number` (required, 1-based). This is universal across all parsed types in the codebase — `ChartDataPoint`, `D3DataItem`, `SequenceParticipant`, `SequenceMessage`, `ArcLink`, etc. Enables editor sync and error reporting.

**Error field:** Use `error?: string` (single optional string). Mirrors `ParsedChart`, `ParsedEChart`, `ParsedD3`, `ParsedSequenceDgmo`. Not an array — one error per parse attempt.

**Arrays:** Collections (`nodes`, `edges`) are never nullable — always `Type[]`, initialized as `[]` by parsers. Optional collections like `groups` use `Type[]` with `?` on the field.

**Type field:** Use literal string `'flowchart'` for now. When adding future diagram types, this becomes a union: `'flowchart' | 'state' | 'er' | 'class' | 'c4'`.

### Target Interface Signatures

```typescript
// src/graph/types.ts

export type GraphShape =
  | 'terminal'    // ()  — rounded/stadium
  | 'process'     // []  — rectangle
  | 'decision'    // <>  — diamond
  | 'io'          // //  — parallelogram
  | 'subroutine'  // [[]] — double-bordered rectangle
  | 'document';   // [~] — wavy-bottom rectangle

export type GraphDirection = 'TB' | 'LR';

export interface GraphNode {
  id: string;
  label: string;
  shape: GraphShape;
  color?: string;
  group?: string;
  lineNumber: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: string;
  color?: string;
  lineNumber: number;
}

export interface GraphGroup {
  id: string;
  label: string;
  color?: string;
  nodeIds: string[];
  lineNumber: number;
}

export interface ParsedGraph {
  type: 'flowchart';
  title?: string;
  direction: GraphDirection;
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups?: GraphGroup[];
  error?: string;
}
```

### Alignment with Existing Patterns

| Aspect | Existing Convention | This Story |
|--------|-------------------|------------|
| Participants/Nodes | `SequenceParticipant { id, label, type, lineNumber }` | `GraphNode { id, label, shape, lineNumber }` |
| Edges/Links | `ArcLink { source, target, value, color, lineNumber }` | `GraphEdge { source, target, label?, color?, lineNumber }` |
| Groups | `SequenceGroup { name, color?, participantIds, lineNumber }` | `GraphGroup { id, label, color?, nodeIds, lineNumber }` |
| Parsed result | `ParsedSequenceDgmo { title, participants[], elements[], groups[], error }` | `ParsedGraph { title?, direction, nodes[], edges[], groups?, error? }` |
| Shape discriminant | `ParticipantType` (10-value union) | `GraphShape` (6-value union, extensible) |

### Project Structure Notes

- New file: `src/graph/types.ts` — first file in `src/graph/` directory (future: `layout.ts`, `flowchart-parser.ts`, `flowchart-renderer.ts`)
- Export from: `src/index.ts` — add new export block after sequence diagram exports
- Test file: `tests/graph-types.test.ts` — follows existing test naming: `tests/<module>.test.ts`
- No new dependencies — pure TypeScript types only

### References

- [Source: docs/epics/epic-48.structural-diagrams-flowchart.md#Story 48.1]
- [Source: src/sequence/parser.ts — SequenceParticipant, SequenceGroup patterns]
- [Source: src/d3.ts — D3DataItem, ArcLink, VennSet color patterns]
- [Source: src/echarts.ts — ParsedEChart, ParsedSankeyLink patterns]
- [Source: src/chart.ts — ParsedChart, ChartDataPoint patterns]
- [Source: src/index.ts — export patterns]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

No issues encountered.

### Completion Notes List

- Created `src/graph/types.ts` with all 6 type definitions matching target signatures exactly
- Exported all types from `src/index.ts` (added after sequence diagram exports block)
- Created `tests/graph-types.test.ts` with 14 compile-time type assertion tests using `expectTypeOf` + 1 runtime assertion test
- Tests verify: all 6 shapes, required vs optional fields, @ts-expect-error for invalid values, full ParsedGraph construction with all shapes
- `pnpm build` — clean, types appear in `dist/index.d.ts` (12 type references)
- `pnpm typecheck` — clean
- `pnpm test` — 190 tests pass, 0 regressions
- Pure types only — no runtime code added (AC: 4)

### File List

- `src/graph/types.ts` — NEW — shared graph data model types
- `src/index.ts` — MODIFIED — added graph type exports
- `tests/graph-types.test.ts` — NEW — type validation tests
