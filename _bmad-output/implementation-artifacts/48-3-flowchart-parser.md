# Story 48.3: Flowchart Parser

Status: review

## Story

As a developer building structural diagram support for dgmo,
I want a parser that converts the flowchart DSL syntax into the shared `ParsedGraph` model,
so that flowchart `.dgmo` files can be processed through the Dagre layout engine and rendered to SVG.

## Acceptance Criteria

1. All 6 shape types parse correctly with labels extracted
2. Unlabeled, labeled, colored, and labeled+colored edges all parse
3. Indented branches under `<Decision>` associate correctly
4. Nested decisions (multi-level indent) parse correctly
5. Inline chains (`[A] -> [B] -> [C]`) produce correct edges
6. One-per-line chains (indented `-> [B]`) produce correct edges
7. Convergence detected: same label+shape = same node ID
8. Back-edges create edges to existing nodes (loops)
9. Groups parse with color and member nodes
10. Node colors parse from inline `(color)` syntax
11. `title:` and `direction:` metadata parsed
12. Comments (`//`) ignored
13. Line numbers tracked on all elements
14. Malformed input produces helpful error messages
15. Comprehensive test suite covering all syntax features
16. `pnpm build && pnpm typecheck` passes
17. No regression on existing chart types

## Tasks / Subtasks

- [x] Task 1: Create `src/graph/flowchart-parser.ts` with function skeleton (AC: 16)
  - [x] 1.1: Create `parseFlowchart(content: string, palette?: PaletteColors): ParsedGraph` function
  - [x] 1.2: Initialize result with `type: 'flowchart'`, `direction: 'TB'`, `nodes: []`, `edges: []`
  - [x] 1.3: Set up line-by-line iteration with `lineNumber = i + 1` (1-based)
  - [x] 1.4: Import `resolveColor` from `../colors` and `PaletteColors` from `../palettes`
  - [x] 1.5: Import `ParsedGraph`, `GraphNode`, `GraphEdge`, `GraphGroup`, `GraphDirection` from `./types`

- [x] Task 2: Parse metadata directives (AC: 11, 12)
  - [x] 2.1: Parse `chart: flowchart` — validate type, set `hasExplicitChart` flag
  - [x] 2.2: Parse `title: <text>` — store as `result.title`
  - [x] 2.3: Parse `direction: TB | LR` — store as `result.direction`, validate values
  - [x] 2.4: Skip comments (`//`) at any position
  - [x] 2.5: Skip empty lines
  - [x] 2.6: Enforce metadata-before-content ordering (error if metadata appears after first node/edge)

- [x] Task 3: Implement shape parsing regex patterns (AC: 1, 10)
  - [x] 3.1: Define regex for terminal shape: `/\(([^)]+)\)/` — extracts label from `(Label)`
  - [x] 3.2: Define regex for process shape: `/\[([^\]~]+)\]/` — extracts label from `[Label]` (excludes `~` for document)
  - [x] 3.3: Define regex for decision shape: `/\<([^>]+)\>/` — extracts label from `<Label>`
  - [x] 3.4: Define regex for I/O shape: `/\/([^\/]+)\//` — extracts label from `/Label/`
  - [x] 3.5: Define regex for subroutine shape: `/\[\[([^\]]+)\]\]/` — extracts label from `[[Label]]`
  - [x] 3.6: Define regex for document shape: `/\[([^\]]+)~\]/` — extracts label from `[Label~]`
  - [x] 3.7: Implement `parseNodeRef(text: string)` helper that returns `{ id, label, shape, color? }` by trying regexes in order (subroutine before process, document before process)
  - [x] 3.8: Extract inline color from label: `/\(([^)]+)\)\s*$/` before shape-closing character — e.g., `[Process(blue)]` → color: blue, label: Process
  - [x] 3.9: Generate stable node IDs from `shape + ':' + label.toLowerCase().trim()` — same shape+label = same node (convergence)
  - [x] 3.10: Resolve colors via `resolveColor(colorName, palette)`

- [x] Task 4: Implement edge parsing (AC: 2)
  - [x] 4.1: Define edge regex: `/^-(\w[^(]*?)?\s*(?:\(([^)]+)\))?\s*->/` — matches `-label(color)->`, `-label->`, `-(color)->`, `->`
  - [x] 4.2: Implement `parseEdgeLabel(text: string)` helper that returns `{ label?, color?, remainder }` from arrow syntax
  - [x] 4.3: Handle all 4 edge variants: unlabeled `->`, labeled `-label->`, colored `-(color)->`, labeled+colored `-label(color)->`

- [x] Task 5: Implement inline chain parsing (AC: 5)
  - [x] 5.1: Split line on `->` to detect inline chains
  - [x] 5.2: For each pair of adjacent segments, extract source node, edge label/color, and target node
  - [x] 5.3: Register all nodes encountered (or look up existing by ID for convergence)
  - [x] 5.4: Create edges between consecutive nodes in the chain
  - [x] 5.5: Track the last node in the chain as the "current node" for subsequent indented lines

- [x] Task 6: Implement indentation-based branching (AC: 3, 4, 6)
  - [x] 6.1: Implement `measureIndent(line: string): number` — count leading spaces (tabs = 4 spaces)
  - [x] 6.2: Maintain an indent stack: `{ node: GraphNode, indent: number }[]`
  - [x] 6.3: When indent increases, the previous node becomes the implicit source for the next edge
  - [x] 6.4: When indent decreases, pop the stack to find the correct parent scope
  - [x] 6.5: Handle indented `-> [B]` (one-per-line continuation) — implicit source is parent on indent stack
  - [x] 6.6: Handle indented `-label-> [B]` (labeled branch under decision) — source is the decision node
  - [x] 6.7: Handle nested decisions: deeper indentation creates new stack frames
  - [x] 6.8: Handle edge-only lines (start with `->` or `-label->`) vs full chain lines

- [x] Task 7: Implement convergence and back-edges (AC: 7, 8)
  - [x] 7.1: Maintain a `Map<string, GraphNode>` keyed by node ID (shape+label)
  - [x] 7.2: When a node reference matches an existing ID, reuse the existing node (don't create a new one)
  - [x] 7.3: Back-edges (referencing an earlier node) automatically work via convergence — the edge simply targets an existing node

- [x] Task 8: Implement group parsing (AC: 9)
  - [x] 8.1: Match `## GroupName(color)` pattern using regex: `/^##\s+(.+?)(?:\(([^)]+)\))?\s*$/`
  - [x] 8.2: Create `GraphGroup` with `id`, `label`, `color` (resolved via `resolveColor`)
  - [x] 8.3: Track current active group — nodes parsed while a group is active get added to that group's `nodeIds`
  - [x] 8.4: Group scope ends when a new `##` heading appears or when indentation returns to column 0 with no group context
  - [x] 8.5: Set `group` field on `GraphNode` when node belongs to a group
  - [x] 8.6: Cross-group references: when a node referenced in group B already exists from group A, it stays in group A (first assignment wins)

- [x] Task 9: Implement error handling (AC: 14)
  - [x] 9.1: Error on missing shape characters (bare text that looks like a node reference)
  - [x] 9.2: Error on unclosed brackets/shapes (mismatched delimiters)
  - [x] 9.3: Error on empty content (no nodes found)
  - [x] 9.4: Error on edge with no source (edge at top level before any node)
  - [x] 9.5: Include line numbers in all error messages: `Line ${lineNumber}: description`
  - [x] 9.6: Return early with `result.error` set (single error, not array — matches codebase convention)

- [x] Task 10: Create `looksLikeFlowchart()` detection function (AC: 16)
  - [x] 10.1: Implement `looksLikeFlowchart(content: string): boolean` — detects flowchart content without explicit `chart:` header
  - [x] 10.2: Check for characteristic patterns: shape delimiters `()[]<>` combined with `->` arrows
  - [x] 10.3: Ensure it doesn't false-positive on sequence diagrams (sequence uses `->` but with different node syntax)

- [x] Task 11: Export from `src/index.ts` (AC: 16)
  - [x] 11.1: Export `parseFlowchart` and `looksLikeFlowchart` from `./graph/flowchart-parser`

- [x] Task 12: Write tests in `tests/flowchart-parser.test.ts` (AC: 1–15)
  - [x] 12.1: Test metadata parsing: `chart: flowchart`, `title:`, `direction: TB`, `direction: LR`
  - [x] 12.2: Test terminal shape: `(Start)` → node with shape `terminal`
  - [x] 12.3: Test process shape: `[Do Thing]` → node with shape `process`
  - [x] 12.4: Test decision shape: `<Valid?>` → node with shape `decision`
  - [x] 12.5: Test I/O shape: `/Read Input/` → node with shape `io`
  - [x] 12.6: Test subroutine shape: `[[Validate]]` → node with shape `subroutine`
  - [x] 12.7: Test document shape: `[Report~]` → node with shape `document`
  - [x] 12.8: Test inline chain: `(Start) -> [Step 1] -> [Step 2] -> (End)` → 4 nodes, 3 edges
  - [x] 12.9: Test labeled edge: `[A] -yes-> [B]` → edge with label `yes`
  - [x] 12.10: Test colored edge: `[A] -(blue)-> [B]` → edge with color
  - [x] 12.11: Test labeled+colored edge: `[A] -yes(red)-> [B]` → edge with label and color
  - [x] 12.12: Test indented branching under decision: `<Check?>\n  -yes-> [A]\n  -no-> [B]` → 2 edges from decision
  - [x] 12.13: Test nested decisions (multi-level indent)
  - [x] 12.14: Test one-per-line chains: `(Start)\n  -> [Step]\n  -> (End)`
  - [x] 12.15: Test convergence: same `[Merge]` referenced twice → single node, two edges into it
  - [x] 12.16: Test back-edge (loop): referencing earlier node creates edge back
  - [x] 12.17: Test groups: `## API(blue)\n  [A] -> [B]` → group with color, member nodes
  - [x] 12.18: Test node inline color: `[Process(blue)]` → node with color
  - [x] 12.19: Test comments: `// this is ignored` → skipped
  - [x] 12.20: Test error: empty content → `error` set on result
  - [x] 12.21: Test error: edge before any node → `error` set
  - [x] 12.22: Test line numbers on all nodes and edges
  - [x] 12.23: Test `looksLikeFlowchart()` function
  - [x] 12.24: Run `pnpm test` — all tests pass

- [x] Task 13: Final verification (AC: 16, 17)
  - [x] 13.1: Run `pnpm build && pnpm typecheck && pnpm test`

## Dev Notes

### Parser Architecture

The parser follows the same line-by-line iteration pattern used by `parseSequenceDgmo()` in `src/sequence/parser.ts`. Key patterns to replicate:

```typescript
export function parseFlowchart(
  content: string,
  palette?: PaletteColors
): ParsedGraph {
  const lines = content.split('\n');
  const result: ParsedGraph = {
    type: 'flowchart',
    direction: 'TB',
    nodes: [],
    edges: [],
  };

  const nodeMap = new Map<string, GraphNode>(); // convergence: id → node
  const indentStack: { nodeId: string; indent: number }[] = [];
  let currentGroup: GraphGroup | null = null;
  const groups: GraphGroup[] = [];
  let contentStarted = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const lineNumber = i + 1;
    const indent = measureIndent(raw);

    if (!trimmed) continue;
    if (trimmed.startsWith('//')) continue;

    // Metadata, then groups, then content...
  }

  if (groups.length > 0) result.groups = groups;
  return result;
}
```

### Node ID Generation (Convergence)

Same shape + same label (case-insensitive) = same node. This enables convergence and back-edges naturally:

```typescript
function nodeId(shape: GraphShape, label: string): string {
  return `${shape}:${label.toLowerCase().trim()}`;
}
```

### Shape Parsing Priority

Subroutine (`[[...]]`) and document (`[...~]`) must be checked BEFORE generic process (`[...]`) to avoid false matches:

1. `[[Label]]` → subroutine
2. `[Label~]` → document
3. `[Label]` → process
4. `(Label)` → terminal
5. `<Label>` → decision
6. `/Label/` → I/O

### Indentation Stack

The indent stack tracks the implicit source node for branching:

```
<Valid?>           ← indent 0, pushes decision onto stack
  -yes-> [A]      ← indent 2, source = decision (top of stack), pushes [A]
    -> [B]         ← indent 4, source = [A] (top of stack)
  -no-> [C]       ← indent 2, pops back to decision, source = decision
[Next]            ← indent 0, pops everything, new root node
```

### Inline Color Extraction

Color appears inside the label, before the closing shape character:

```
[Process(blue)]  → label: "Process", color: "blue"
<Check?(red)>    → label: "Check?", color: "red"
[Report(teal)~]  → label: "Report", color: "teal"
```

Regex: extract `(colorName)` from the end of the label text, then resolve via `resolveColor()`.

### Codebase Patterns

- **Error format:** `result.error = \`Line ${lineNumber}: description\``; return early
- **Color resolution:** `resolveColor(colorName, palette)` from `src/colors.ts`
- **Line numbers:** 1-based, required on all `GraphNode` and `GraphEdge` instances
- **Optional fields:** Use `color?: string` (not `null`), `label?: string` for edges
- **File location:** `src/graph/flowchart-parser.ts`
- **Test file:** `tests/flowchart-parser.test.ts`
- **Imports from:** `src/graph/types.ts`, `src/colors.ts`, `src/palettes`

### Inline Chain Splitting

For `(Start) -> [Step 1] -yes-> [Step 2] -> (End)`:

1. Split on `->` while preserving edge labels: scan for `->` not preceded by `-` (the arrow delimiter)
2. Actually easier: split on the full arrow pattern `-...->` which includes optional labels
3. Between each pair of segments: parse the source node from left segment, the edge label from the arrow, and the target node from right segment

### References

- [Source: docs/epics/epic-48.structural-diagrams-flowchart.md#Story 48.3]
- [Source: src/sequence/parser.ts — indentation, block stack, group parsing patterns]
- [Source: src/chart.ts — metadata header parsing pattern]
- [Source: src/echarts.ts — arrow syntax parsing]
- [Source: src/colors.ts — resolveColor]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- `-(blue)->` color-only edge parsing bug: `splitArrows()` correctly extracted the color but `parseArrowToken()` regex `^-(.+?)(?:\(([^)]+)\))?->$` captured `(blue)` as a label (lazy `.+?` expansion) instead of a color. Fixed by adding explicit color-only pattern `^-\(([^)]+)\)->$` check before the general regex.

### Completion Notes List

- Created `src/graph/flowchart-parser.ts` with `parseFlowchart()` and `looksLikeFlowchart()` functions
- Parser handles: all 6 shape types, 4 edge variants (unlabeled, labeled, colored, labeled+colored), inline chains, indentation-based branching, nested decisions, one-per-line chains, convergence (same shape+label = same node ID), back-edges (loops), groups with `## GroupName(color)`, node inline colors, metadata (chart/title/direction), comments (`//`), line numbers on all elements
- Shape parsing order: subroutine → document → process → terminal → decision → I/O
- Arrow splitting uses two-phase approach: `splitArrows()` tokenizes line segments, `parseArrowToken()` extracts label/color from arrow tokens
- Indent stack tracks implicit source nodes for branching: `{ nodeId: string; indent: number }[]`
- Node ID convergence via `shape:label.toLowerCase().trim()` — enables natural back-edges and merge points
- `looksLikeFlowchart()` detects flowchart content by checking for shape delimiters near arrows, avoiding false positives on sequence diagrams
- Created `tests/flowchart-parser.test.ts` with 34 tests covering all ACs
- Exported `parseFlowchart` and `looksLikeFlowchart` from `src/index.ts`
- `pnpm build` — clean
- `pnpm typecheck` — clean
- `pnpm test` — 235 tests pass, 0 regressions

### File List

- `src/graph/flowchart-parser.ts` — NEW — Flowchart DSL parser + detection helper
- `src/index.ts` — MODIFIED — added parseFlowchart/looksLikeFlowchart exports
- `tests/flowchart-parser.test.ts` — NEW — 34 parser tests
