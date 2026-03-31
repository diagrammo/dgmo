---
title: 'Preserve Group Collapse State During Editing'
slug: 'preserve-group-collapse-during-editing'
created: '2026-03-10'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['TypeScript', 'React']
files_to_modify: ['diagrammo-app/src/features/preview/components/InfraPreview.tsx']
code_patterns: ['functional setState updater', 'useEffect([content]) reset pattern']
test_patterns: []
---

# Tech-Spec: Preserve Group Collapse State During Editing

**Created:** 2026-03-10

## Overview

### Problem Statement

When the user edits the infra diagram source (any keystroke), all interactively-collapsed `[Group]` containers immediately expand. The `useEffect([content])` in `InfraPreview.tsx` fires on every content change and unconditionally calls `setCollapsedGroups(initial)` — rebuilding the set from scratch using only groups with `collapsed: true` declared in the source. Any groups the user collapsed interactively are wiped. The async cache restore cannot help here because the content hash changes on every keystroke, so no cached view state exists for the new content.

### Solution

Replace the `setCollapsedGroups(initial)` call with a functional updater that preserves existing collapsed state across content changes:
1. Keep all currently-collapsed group IDs that still exist in the new parse
2. Add any newly-appearing groups that have `collapsed: true` in source (and weren't previously tracked)
3. Remove group IDs that no longer exist in the new parse (pruning)

### Scope

**In Scope:**
- Preserve `collapsedGroups` React state across in-session edits
- Still respect source-declared `collapsed: true` for groups that newly appear

**Out of Scope:**
- `collapsedNodes` (individual node collapse — already preserved during edits, not reset)
- Cache persistence via `infra-view-cache` (separate mechanism, unaffected)
- Persisting collapse state across sessions (already handled by cache; this fix only affects in-session behavior)

---

## Context for Development

### Codebase Patterns

**The bug site** (`InfraPreview.tsx`, the `useEffect([content])` block, ~line 162):
```typescript
// Reset interactive state when source content changes
useEffect(() => {
  if (!rpsWritePending.current) {
    setRpsMultiplier(1);
    setPopoverEdge(null);
    setInstanceOverrides({});
    // BUG: This resets collapsed state on every keystroke
    if (parsed) {
      const initial = new Set<string>();
      for (const g of parsed.groups) {
        if (g.collapsed) initial.add(g.id);
      }
      setCollapsedGroups(initial);   // ← resets on every content change
    }
  }
  // ... async cache load (can't restore because hash changed)
}, [content]);
```

**Fix pattern** — use functional updater to preserve existing state:
```typescript
if (parsed) {
  const existingGroupIds = new Set(parsed.groups.map((g) => g.id));
  setCollapsedGroups((prev) => {
    // Prune groups that no longer exist in the new parse
    const next = new Set([...prev].filter((id) => existingGroupIds.has(id)));
    // Add newly-appearing groups declared collapsed: true in source
    for (const g of parsed.groups) {
      if (g.collapsed && !prev.has(g.id)) next.add(g.id);
    }
    return next;
  });
}
```

**Why `!prev.has(g.id)` for the `collapsed: true` check:**
- If a group was previously expanded interactively (removed from `prev`), don't force it back to collapsed just because source still says `collapsed: true`
- Only add to the set if the group ID was not previously tracked at all (newly appeared in the parse)

**`collapsedGroups` flow:**
- Initialized via this `useEffect([content])`
- Toggled by `onNodeToggle` callback (click on group border)
- Passed to `computeInfra` as `computeParams.collapsedGroups`
- Saved to `infra-view-cache` (debounced, only when content is stable)

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `diagrammo-app/src/features/preview/components/InfraPreview.tsx` | The only file to change; bug is in the `useEffect([content])` block |
| `diagrammo-app/src/lib/infra-view-cache.ts` | Cache mechanism (read-only reference; no changes needed) |

### Technical Decisions

- Use the functional `setState(prev => next)` updater pattern — ensures we see the latest `collapsedGroups` state without adding it to the effect's dependency array (which would cause infinite loops)
- `parsed` is derived from `content` via `useMemo`, so it's always in sync with the latest content inside this effect
- No changes to the cache mechanism — cache save/load is keyed by content hash and is unaffected

---

## Implementation Plan

### Tasks

- [ ] **Task 1: Replace `setCollapsedGroups(initial)` with functional updater in `InfraPreview.tsx`**
  - File: `diagrammo-app/src/features/preview/components/InfraPreview.tsx`
  - Location: Inside `useEffect(() => { ... }, [content])`, the `if (parsed)` block (~line 167)
  - Replace:
    ```typescript
    if (parsed) {
      const initial = new Set<string>();
      for (const g of parsed.groups) {
        if (g.collapsed) initial.add(g.id);
      }
      setCollapsedGroups(initial);
    }
    ```
  - With:
    ```typescript
    if (parsed) {
      const existingGroupIds = new Set(parsed.groups.map((g) => g.id));
      setCollapsedGroups((prev) => {
        const next = new Set([...prev].filter((id) => existingGroupIds.has(id)));
        for (const g of parsed.groups) {
          if (g.collapsed && !prev.has(g.id)) next.add(g.id);
        }
        return next;
      });
    }
    ```

### Acceptance Criteria

- [ ] **AC-1:** Given a diagram with a `[Group]` that the user collapses interactively, when the user types in the editor, then the group remains collapsed.

- [ ] **AC-2:** Given a diagram with a `[Group]` that the user expands (it was `collapsed: true` in source), when the user types in the editor, then the group remains expanded.

- [ ] **AC-3:** Given a diagram with a `[Group collapsed]` declared in source and no prior interactive toggle, when the user opens the file, then the group starts collapsed (initial load behavior unchanged).

- [ ] **AC-4:** Given a collapsed `[Group]` whose name is changed in the editor (making it a new group ID), when the diagram re-renders, then the old group ID is pruned from collapsed state (no ghost entries), and the renamed group starts expanded.

- [ ] **AC-5:** Given a diagram with no groups, when the user edits, then no errors occur and behavior is unchanged.

---

## Additional Context

### Dependencies

None — single-file change in the app. No dgmo library changes.

### Testing Strategy

- Manual: open a diagram with groups, collapse one, type — verify it stays collapsed
- Manual: confirm source-declared `collapsed: true` groups still start collapsed on fresh open

### Notes

- `collapsedNodes` (individual node body collapse, separate from group containers) is already preserved during edits — it's not reset in the content-change effect. No change needed there.
- The cache save at `InfraPreview.tsx:205-224` already only saves when content is stable (skips the first render after content changes). This fix is orthogonal to the cache.
