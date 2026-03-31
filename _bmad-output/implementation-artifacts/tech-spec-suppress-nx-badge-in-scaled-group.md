---
title: 'Suppress Nx Badge on Nodes Inside a Scaled Group'
slug: 'suppress-nx-badge-in-scaled-group'
created: '2026-03-09'
status: 'Completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['TypeScript', 'D3', 'SVG', 'Vitest']
files_to_modify: ['src/infra/renderer.ts']
code_patterns: ['renderNodes receives layout.nodes + layout.groups', 'instance badge condition at renderer.ts:911', 'node.groupId already populated from layout']
test_patterns: ['vitest', 'infra-layout.test.ts parse→compute→layout helper pattern', 'badge suppression validated visually']
---

# Tech-Spec: Suppress Nx Badge on Nodes Inside a Scaled Group

**Created:** 2026-03-09

## Overview

### Problem Statement

When a `[Group]` container has an `Nx` instances multiplier (e.g. `instances: 3` or `x3`), every child node inside that group also renders its own `Nx` badge in its top-right corner. Since the group header already displays the indicator, the per-node badge is redundant and adds visual noise.

### Solution

In `renderNodes`, build a `Set<string>` of group IDs whose `instances > 1` from `layout.groups` (available in `renderInfra` scope). Before rendering the instance badge on a node, skip it if `node.groupId` is in that set.

### Scope

**In Scope:**
- Suppress the instance badge on child nodes whose parent group has `instances > 1`
- Nodes outside any group, or inside a group with no instances (or `instances === 1`), continue to show their badge unchanged
- Group header badge is untouched

**Out of Scope:**
- Collapsed group node behavior — collapsed group nodes (`id.startsWith('[')`) have `groupId === null` and are unaffected
- Serverless concurrency badge (separate code path, `computedConcurrentInvocations > 0` guard)
- RPS/compute/parse/layout logic changes

---

## Context for Development

### Codebase Patterns

**Instance badge render site** (`src/infra/renderer.ts`, line ~911):
```typescript
// Instance badge — clickable for interactive adjustment (not for edge or serverless nodes)
// Serverless nodes show instances in a computed row instead (demand / concurrency).
if (!node.isEdge && node.computedConcurrentInvocations === 0 && node.computedInstances > 1) {
  const badgeText = `${node.computedInstances}x`;
  g.append('text')
    .attr('x', x + node.width - 6)
    .attr('y', y + NODE_HEADER_HEIGHT / 2 + META_FONT_SIZE * 0.35)
    .attr('text-anchor', 'end')
    .attr('font-family', FONT_FAMILY)
    .attr('font-size', META_FONT_SIZE)
    .attr('fill', mutedColor)
    .attr('data-instance-node', node.id)
    .style('cursor', 'pointer')
    .text(badgeText);
}
```
This is the **only** render site for the node `Nx` badge.

**Group instances badge** (`src/infra/renderer.ts`, line ~465-472):
```typescript
// Group instances badge (top-right, like node instance badges)
const gi = typeof group.instances === 'number' ? group.instances :
  typeof group.instances === 'string' ? parseInt(String(group.instances), 10) || 0 : 0;
// renders badge when gi > 0
```
Use the same `typeof` parsing pattern to determine if a group is "scaled".

**Node group membership**: `InfraLayoutNode.groupId: string | null` — populated by `layoutInfra` at `layout.ts:486`. Non-null means the node is inside a named group.

**`renderNodes` current call site** (`renderer.ts`, line ~1526):
```typescript
const fanoutSourceIds = collectFanoutSourceIds(layout.edges);
renderNodes(svg, layout.nodes, palette, isDark, shouldAnimate, selectedNodeId,
  activeGroup, layout.options, collapsedNodes, tagGroups ?? [], fanoutSourceIds);
```

**Collapsed group nodes**: Represented as nodes with `id.startsWith('[')` and `groupId === null`. They render as the group itself, not as children — badge suppression does not affect them.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src/infra/renderer.ts` | Badge render site (line ~911); `renderNodes` signature; group badge reference (line ~465) |
| `src/infra/layout.ts` | `InfraLayoutNode.groupId`, `InfraLayoutGroup.instances` type definitions |
| `tests/infra-layout.test.ts` | Test helper pattern: `layout(source)` → `parseInfra → computeInfra → layoutInfra` |

### Technical Decisions

- Pass `scaledGroupIds: Set<string>` into `renderNodes` (not the full groups array) — minimal interface change, consistent with `fanoutSourceIds` pattern added in previous session.
- Build `scaledGroupIds` in `renderInfra` alongside `fanoutSourceIds`, before the `renderNodes` call.
- Parse `group.instances` using the same `typeof` guard already used in the group badge renderer to stay consistent.
- Guard: `node.groupId != null && scaledGroupIds.has(node.groupId)` — explicit null check before the `Set.has` call.

---

## Implementation Plan

### Tasks

- [x] **Task 1: Build `scaledGroupIds` in `renderInfra` and pass to `renderNodes`**
  - File: `src/infra/renderer.ts`
  - Action: In `renderInfra`, just before the `renderNodes` call (~line 1525), add:
    ```typescript
    const scaledGroupIds = new Set<string>(
      layout.groups
        .filter((g) => {
          const gi = typeof g.instances === 'number' ? g.instances
            : typeof g.instances === 'string' ? parseInt(String(g.instances), 10) || 0 : 0;
          return gi > 1;
        })
        .map((g) => g.id)
    );
    ```
    Then append `scaledGroupIds` as the final argument to the `renderNodes(...)` call.
  - Notes: `layout.groups` is already in scope in `renderInfra`. Keep this alongside the `fanoutSourceIds` line for consistency.

- [x] **Task 2: Add `scaledGroupIds` parameter to `renderNodes` and apply suppression**
  - File: `src/infra/renderer.ts`
  - Action A — Add parameter to `renderNodes` signature (after `fanoutSourceIds`):
    ```typescript
    scaledGroupIds?: Set<string>,
    ```
  - Action B — In the instance badge block (~line 911), replace the condition:
    ```typescript
    // Before:
    if (!node.isEdge && node.computedConcurrentInvocations === 0 && node.computedInstances > 1) {

    // After:
    const inScaledGroup = node.groupId != null && (scaledGroupIds?.has(node.groupId) ?? false);
    if (!node.isEdge && node.computedConcurrentInvocations === 0 && node.computedInstances > 1 && !inScaledGroup) {
    ```
  - Notes: `inScaledGroup` is a one-liner computed just before the `if`. The rest of the badge render block is unchanged.

- [x] **Task 3: Add a test for `groupId` propagation on child nodes of a scaled group**
  - File: `tests/infra-layout.test.ts`
  - Action: Add a `describe('scaled group')` block with a test that parses a diagram with a `[Group] x3` containing two nodes, lays it out, and asserts that each child node has `groupId === '[Group]'` (or the group's parsed id) and that the group's `instances` equals `3`.
  - Notes: The badge suppression itself is a renderer concern (D3/SVG) — not testable in unit tests. The test covers the layout data that the suppression logic depends on.

### Acceptance Criteria

- [ ] **AC-1:** Given an infra diagram with a `[Group]` that has `instances: 3`, when the diagram renders, then child nodes inside the group do NOT show a `3x` badge in their header area, AND the group border header still shows `3x`.

- [ ] **AC-2:** Given a node NOT inside any group with `computedInstances > 1`, when the diagram renders, then the `Nx` badge still appears on that node unchanged.

- [ ] **AC-3:** Given a node inside a group with no `instances` property (or `instances === 1`), when the diagram renders, then the node's `Nx` badge renders normally.

- [ ] **AC-4:** Given a collapsed group with `instances > 1`, when it renders as a collapsed node (`id.startsWith('[')`), then its `Nx` badge still appears (its `groupId` is `null`, so the suppression guard is bypassed).

- [ ] **AC-5:** Given a serverless node (with `concurrency` property) inside a scaled group, when rendered, then the serverless concurrency row in the node body is unaffected (the badge suppression only targets the top-right `Nx` badge path, not the serverless path).

---

## Additional Context

### Dependencies

None. Pure renderer change — no parser, compute, or layout modifications required.

### Testing Strategy

- **Unit test** (`tests/infra-layout.test.ts`): Verify `groupId` is correctly set on child nodes of a scaled group and that `group.instances` is preserved through layout. This validates the data the suppression logic depends on.
- **Visual validation**: Open (or author) a diagram with a `[Group] x3` containing child nodes, confirm no per-node `3x` badge appears in the child node headers, confirm the group still shows `3x`.

Example validation diagram:
```
chart: infra

edge
  rps: 1000
  -> [Shards]

[Shards]
  instances: 3

  ShardA
    max-rps: 5000
    latency-ms: 2

  ShardB
    max-rps: 5000
    latency-ms: 2
```
Expected: `ShardA` and `ShardB` show no `3x` badge; `[Shards]` group shows `3x`.

### Notes

- The group badge uses `gi > 0` as its threshold (renders even for `x1` if explicitly declared), while the node badge uses `> 1`. No change to either threshold.
- If a group has `instances: 1` explicitly declared, `scaledGroupIds` will not include it (`gi > 1` filter), so child nodes will still show their own `1x`... but `computedInstances > 1` would also be false, so they wouldn't show a badge anyway. No conflict.
- Future: if per-node `instances` override inside a group ever becomes meaningful (different from the group multiplier), this suppression logic may need revisiting. For now, it's always the same value.
