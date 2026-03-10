---
title: 'Infra Diagram — Service Level Objectives (SLOs)'
slug: 'infra-slo-thresholds'
created: '2026-03-09'
status: 'Completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['TypeScript', 'D3', 'SVG', 'Vitest']
files_to_modify: ['src/infra/parser.ts', 'src/infra/renderer.ts']
code_patterns: ['chart-level options like default-latency-ms', 'worstNodeSeverity() + nodeColor() + getComputedRows() in renderer', 'per-node PROPERTY_RE already captures slo-* keys']
test_patterns: ['vitest', 'infra-parser.test.ts for option parsing', 'infra-compute.test.ts for SLO propagation']
---

# Tech-Spec: Infra Diagram — Service Level Objectives (SLOs)

**Created:** 2026-03-09

## Overview

### Problem Statement

Infra diagram nodes currently use hardcoded availability thresholds (`< 0.95` → red, `< 0.99` → yellow) with no user control and no latency-based coloring. Users have no way to express what "good" looks like for their system — and nothing turns green even when all SLOs are comfortably met.

### Solution

Add `slo-availability`, `slo-p90-latency-ms`, and `slo-warning-margin` as first-class chart-level options and per-node property overrides. The renderer resolves effective SLO thresholds per node and uses them to color nodes: green (comfortably meeting SLO), yellow (within warning margin), red (breaching). When no SLO is declared, existing hardcoded behavior is preserved.

### Scope

**In Scope:**
- Chart-level: `slo-availability: 99.9%`, `slo-p90-latency-ms: 200`, `slo-warning-margin: 5%` in chart header
- Per-node overrides using the same keys (indented under node)
- Green (`COLOR_HEALTHY`) node state when SLO is declared and comfortably met
- Yellow/red states driven by SLO thresholds when declared; fallback to hardcoded `0.95`/`0.99` when no availability SLO
- p90 latency SLO coloring (against `computedLatencyPercentiles.p90`)
- Availability row in `getComputedRows` uses SLO threshold for its color
- p90 row in `getComputedRows` colored when latency SLO declared
- Interactive slider updates color in real-time (no extra work — renderer re-runs on every change)

**Out of Scope:**
- SLO tooltip/violation text (future story)
- p50/p99 latency SLOs (only p90 in this spec per user decision)
- `slo-rps` or capacity-based SLOs (RPS coloring already exists)
- Animation/pulse for 'healthy' state (keep simple for now)
- Persisting SLO state into compute model (stays in renderer)

---

## Context for Development

### Codebase Patterns

**Chart-level options** (`parser.ts:223–231`): Simple `if` blocks matching specific `key: value` lines in the chart header. Pattern to follow:
```typescript
if (/^slo-availability\s*:/i.test(trimmed)) {
  result.options['slo-availability'] = trimmed.replace(/^slo-availability\s*:\s*/i, '').trim();
  continue;
}
```

**Per-node properties**: Already captured automatically by `PROPERTY_RE = /^([\w-]+)\s*:\s*(.+)$/`. No parser change needed for per-node SLO keys — they're stored in `node.properties` as-is.

**`worstNodeSeverity(node)`** (`renderer.ts:342`): Returns `'overloaded' | 'warning' | 'normal'`. Called at lines 393 (nodeColor), 657 (animation pulse), 693 (stroke width). Needs new `'healthy'` return value and `slo` parameter.

**`nodeColor(node, palette, isDark)`** (`renderer.ts:388`): Returns `{ fill, stroke, textFill }` based on severity. Add `'healthy'` branch with green fill/stroke.

**`getComputedRows(node, expanded)`** (`renderer.ts:194`): Builds computed metric rows. Availability row at line 229 uses hardcoded `0.95`/`0.99`. Needs SLO parameter. P90 row currently has no color; add green/yellow/red when latency SLO declared.

**`renderNodes(...)` call sites**: `worstNodeSeverity` is called inside the node loop. `diagramOptions` is already a parameter of `renderNodes` — available in scope for SLO resolution.

**COLOR constants** (`renderer.ts:58–59`):
```typescript
const COLOR_WARNING = '#eab308';
const COLOR_OVERLOADED = '#ef4444';
```
Add: `const COLOR_HEALTHY = '#22c55e';`

### SLO Threshold Logic

**Availability** (higher is better, threshold = minimum floor):
- `sloAvail` = resolved threshold (e.g., 0.999 for 99.9%)
- `margin` = slo-warning-margin / 100 (default 0.05)
- Green: `computedAvailability >= min(1.0, sloAvail + margin)`
- Yellow: `sloAvail <= computedAvailability < min(1.0, sloAvail + margin)`
- Red: `computedAvailability < sloAvail`
- No SLO: fallback to hardcoded `< 0.95` red, `< 0.99` yellow

**Latency p90** (lower is better, threshold = maximum ceiling):
- `sloLatency` = resolved threshold in ms (e.g., 200)
- `margin` = slo-warning-margin / 100 (default 0.05)
- Green: `p90 <= sloLatency * (1 - margin)` (e.g., p90 ≤ 190ms for 200ms SLO at 5% margin)
- Yellow: `sloLatency * (1 - margin) < p90 <= sloLatency`
- Red: `p90 > sloLatency`
- No SLO: no latency-based coloring (current behavior)

**'healthy' state resolution:**
A node is `'healthy'` only if:
1. At least one SLO is declared (availability or latency)
2. All declared SLOs are in the GREEN zone
3. No other condition has already upgraded to `'warning'` or `'overloaded'`

### `NodeSlo` type (inline, no new file needed)
```typescript
interface NodeSlo {
  availThreshold: number | null;   // fraction e.g. 0.999
  latencyP90: number | null;       // ms e.g. 200
  warningMargin: number;           // fraction e.g. 0.05
}
```

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src/infra/parser.ts` | Chart-level options at lines 223–231; PROPERTY_RE at line 50 |
| `src/infra/renderer.ts` | `worstNodeSeverity` (342), `nodeColor` (388), `getComputedRows` (194), `renderNodes` (626) |
| `tests/infra-parser.test.ts` | Pattern for SLO option parsing tests |
| `tests/infra-compute.test.ts` | Pattern for compute helper tests |

### Technical Decisions

- `NodeSlo` is a plain inline interface in `renderer.ts` — not exported, not in types.ts (SLO resolution is a renderer concern)
- `resolveNodeSlo(node, diagramOptions)` is a private helper in renderer.ts
- When `slo-warning-margin` not declared, default to `0.05` (5%)
- `slo-availability` parsed as a percentage string (e.g., `"99.9%"`) → strip `%`, divide by 100
- `slo-p90-latency-ms` parsed as a raw number string → `parseFloat`
- Pass `NodeSlo | null` to `worstNodeSeverity`, `nodeColor`, and `getComputedRows`
- Resolve SLO once per node at the top of the node loop in `renderNodes`, pass down

---

## Implementation Plan

### Tasks

- [x] **Task 1: Add SLO chart-level option keys to parser**
  - File: `src/infra/parser.ts`
  - In the chart header options section (~line 223), add three new `if` blocks following the `default-latency-ms` pattern:
    ```typescript
    if (/^slo-availability\s*:/i.test(trimmed)) {
      result.options['slo-availability'] = trimmed.replace(/^slo-availability\s*:\s*/i, '').trim();
      continue;
    }
    if (/^slo-p90-latency-ms\s*:/i.test(trimmed)) {
      result.options['slo-p90-latency-ms'] = trimmed.replace(/^slo-p90-latency-ms\s*:\s*/i, '').trim();
      continue;
    }
    if (/^slo-warning-margin\s*:/i.test(trimmed)) {
      result.options['slo-warning-margin'] = trimmed.replace(/^slo-warning-margin\s*:\s*/i, '').trim();
      continue;
    }
    ```
  - Notes: Per-node SLO properties need no parser change — PROPERTY_RE already captures them.

- [x] **Task 2: Add `COLOR_HEALTHY`, `NodeSlo` interface, and `resolveNodeSlo()` to renderer**
  - File: `src/infra/renderer.ts`
  - Add constant near line 58: `const COLOR_HEALTHY = '#22c55e';`
  - Add `NodeSlo` interface (private, near the color constants):
    ```typescript
    interface NodeSlo {
      availThreshold: number | null;
      latencyP90: number | null;
      warningMargin: number;
    }
    ```
  - Add `resolveNodeSlo(node: InfraLayoutNode, diagramOptions: Record<string, string>): NodeSlo | null`:
    - Read `slo-availability` from per-node properties first, then `diagramOptions`; strip `%`, divide by 100
    - Read `slo-p90-latency-ms` from per-node properties first, then `diagramOptions`; `parseFloat`
    - Read `slo-warning-margin` from per-node properties first, then `diagramOptions`; strip `%`, divide by 100; default `0.05`
    - If neither `availThreshold` nor `latencyP90` is defined → return `null` (no SLO declared)
    - Otherwise return `{ availThreshold, latencyP90, warningMargin }`
  - Helper for reading a per-node property: use existing `getNodeNumProp` pattern or inline lookup in `node.properties`

- [x] **Task 3: Update `worstNodeSeverity` to accept SLO and return `'healthy'`**
  - File: `src/infra/renderer.ts`
  - Change signature:
    ```typescript
    function worstNodeSeverity(
      node: InfraLayoutNode,
      slo?: NodeSlo | null,
    ): 'overloaded' | 'warning' | 'healthy' | 'normal'
    ```
  - Replace hardcoded availability block (~line 359):
    ```typescript
    // Availability — SLO threshold if declared, otherwise hardcoded fallback
    if (slo?.availThreshold != null) {
      const t = slo.availThreshold;
      const m = slo.warningMargin;
      if (node.computedAvailability < t) upgrade('overloaded');
      else if (node.computedAvailability < Math.min(1, t + m)) upgrade('warning');
      // else: in green zone — handled after loop
    } else {
      if (node.computedAvailability < 0.95) upgrade('overloaded');
      else if (node.computedAvailability < 0.99) upgrade('warning');
    }
    ```
  - Add latency SLO check after availability:
    ```typescript
    // p90 Latency SLO
    if (slo?.latencyP90 != null) {
      const t = slo.latencyP90;
      const m = slo.warningMargin;
      const p90 = node.computedLatencyPercentiles.p90;
      if (p90 > t) upgrade('overloaded');
      else if (p90 > t * (1 - m)) upgrade('warning');
      // else: in green zone
    }
    ```
  - At the end, determine 'healthy':
    ```typescript
    if (worst === 'normal' && slo != null) {
      // Check all declared SLOs are in green zone
      const availGreen = slo.availThreshold == null ||
        node.computedAvailability >= Math.min(1, slo.availThreshold + slo.warningMargin);
      const latencyGreen = slo.latencyP90 == null ||
        node.computedLatencyPercentiles.p90 <= slo.latencyP90 * (1 - slo.warningMargin);
      if (availGreen && latencyGreen) return 'healthy';
    }
    return worst;
    ```

- [x] **Task 4: Update `nodeColor` to handle `'healthy'`**
  - File: `src/infra/renderer.ts`
  - Add `slo?: NodeSlo | null` parameter to `nodeColor`
  - Pass through to `worstNodeSeverity(node, slo)`
  - Add healthy branch:
    ```typescript
    if (severity === 'healthy') {
      return {
        fill: mix(palette.bg, COLOR_HEALTHY, isDark ? 85 : 93),
        stroke: COLOR_HEALTHY,
        textFill: palette.text,
      };
    }
    ```

- [x] **Task 5: Update `getComputedRows` to use SLO for availability and p90 coloring**
  - File: `src/infra/renderer.ts`
  - Add `slo?: NodeSlo | null` parameter to `getComputedRows`
  - Replace hardcoded availability color block (~line 230):
    ```typescript
    if (node.computedAvailability < 1) {
      let color: string | undefined;
      if (slo?.availThreshold != null) {
        const t = slo.availThreshold;
        const m = slo.warningMargin;
        if (node.computedAvailability < t) color = COLOR_OVERLOADED;
        else if (node.computedAvailability < Math.min(1, t + m)) color = COLOR_WARNING;
        else color = COLOR_HEALTHY;
      } else {
        color = node.computedAvailability < 0.95 ? COLOR_OVERLOADED
          : node.computedAvailability < 0.99 ? COLOR_WARNING
          : undefined;
      }
      rows.push({ key: 'availability', value: formatUptimeShort(node.computedAvailability), color, inverted: color != null });
    }
    ```
  - Add p90 coloring when latency SLO declared. After the p90 row is pushed (~line 214), apply color:
    - Find the `rows.push({ key: 'p90', ... })` line and change it to:
    ```typescript
    if (slo?.latencyP90 != null) {
      const t = slo.latencyP90;
      const m = slo.warningMargin;
      const p90 = p.p90;
      const color = p90 > t ? COLOR_OVERLOADED
        : p90 > t * (1 - m) ? COLOR_WARNING
        : COLOR_HEALTHY;
      rows.push({ key: 'p90', value: formatMsShort(p90), color, inverted: color != null });
    } else {
      rows.push({ key: 'p90', value: formatMsShort(p.p90) });
    }
    ```

- [x] **Task 6: Wire up SLO resolution in `renderNodes` and propagate to all call sites**
  - File: `src/infra/renderer.ts`
  - In the node loop inside `renderNodes`, at the top of each node iteration, resolve the SLO:
    ```typescript
    const slo = (!node.isEdge && diagramOptions)
      ? resolveNodeSlo(node, diagramOptions)
      : null;
    ```
  - Pass `slo` to:
    - `nodeColor(node, palette, isDark, slo)`
    - `getComputedRows(node, expanded, slo)`
    - Any direct call to `worstNodeSeverity(node, slo)` inside `renderNodes`
  - For the `worstNodeSeverity` calls outside `renderNodes` (lines 657 + 693 — inside the same node loop): these already have `slo` in scope, so pass it through.
  - Notes: `diagramOptions` is already a parameter of `renderNodes`.

- [x] **Task 7: Add parser tests for SLO chart-level options**
  - File: `tests/infra-parser.test.ts`
  - Add `describe('SLO chart-level options')` block:
    - Chart with `slo-availability: 99.9%` → `result.options['slo-availability'] === '99.9%'`
    - Chart with `slo-p90-latency-ms: 200` → `result.options['slo-p90-latency-ms'] === '200'`
    - Chart with `slo-warning-margin: 10%` → `result.options['slo-warning-margin'] === '10%'`
    - Per-node `slo-availability: 99%` appears in `node.properties` (regression — already works via PROPERTY_RE)

### Acceptance Criteria

- [ ] **AC-1:** Given `slo-availability: 95%` in chart header, when a node has `computedAvailability = 0.92`, then the node renders red; when `computedAvailability = 0.96`, it renders yellow (within default 5% margin); when `computedAvailability = 1.0`, it renders green.

- [ ] **AC-2:** Given `slo-p90-latency-ms: 200` in chart header, when a node has `p90 = 250ms`, it renders red; when `p90 = 195ms`, it renders yellow; when `p90 = 150ms`, it renders green.

- [ ] **AC-3:** Given `slo-warning-margin: 10%`, the warning/green thresholds adjust accordingly (availability margin = 10pp, latency margin = 10% of threshold).

- [ ] **AC-4:** Given a per-node `slo-availability: 99%` that differs from the chart-level `slo-availability: 90%`, the per-node value takes precedence for that node.

- [ ] **AC-5:** Given no SLO declared (neither chart-level nor per-node), nodes use existing hardcoded availability thresholds (`< 0.95` → red, `< 0.99` → yellow); no latency-based coloring; no green state. Existing diagrams are unaffected.

- [ ] **AC-6:** Given a node where ALL declared SLOs are in the green zone AND no RPS/CB/queue conditions trigger, the node renders with green fill and green stroke.

- [ ] **AC-7:** Given a node that is RPS-overloaded (existing behavior) but has a comfortably-met availability SLO, the node renders red (RPS overload takes precedence over SLO green).

- [ ] **AC-8:** The `availability` computed row uses SLO-driven color (green/yellow/red) when SLO is declared. The `p90` computed row gains color when latency SLO is declared.

## Review Notes

- Adversarial review completed
- Findings: 10 total, 5 fixed, 3 skipped (noise/pre-existing), 2 noted
- Resolution approach: auto-fix
- F1/F2 fixed: `worstNodeSeverity` now called once per node, result reused; `nodeColor` accepts pre-computed severity
- F4 fixed: `slo-availability`, `slo-p90-latency-ms`, `slo-warning-margin` added to `INFRA_BEHAVIOR_KEYS`
- F5/F6 fixed: NaN guard added in `resolveNodeSlo`
- F10 fixed: 5 additional tests added for SLO warning suppression and coexistence
- F7/F8 skipped: pre-existing code, not introduced by this change

---

## Additional Context

### Dependencies

None — purely additive feature in parser + renderer. Compute model unchanged.

### Testing Strategy

- **Parser tests** (`infra-parser.test.ts`): verify all three chart-level option keys are stored in `result.options`
- **Renderer logic**: `resolveNodeSlo` and the SLO threshold logic are pure functions — unit-testable if extracted. Coloring itself is visual; validate by opening a diagram with known computed values.
- **Manual validation diagram**:
```
chart: infra
slo-availability: 99%
slo-p90-latency-ms: 200
slo-warning-margin: 5%

edge
  rps: 1000
  -> API

API
  max-rps: 5000
  uptime: 99.8%
  latency-ms: 50
  -> DB

DB
  max-rps: 2000
  uptime: 95%
  latency-ms: 150
```
Expected: API → green (high uptime, low latency); DB → red or yellow depending on cumulative availability.

### Notes

- For very high SLOs (e.g., `slo-availability: 99.9%`), `min(1.0, threshold + margin)` = min(1.0, 1.049) = 1.0 — green zone only when availability = 100% (perfect). This is intentional and documented.
- The `p90` latency row is already shown in expanded mode only — the coloring applies in both expanded and collapsed (p99 row is always shown; only p90/p50 are expanded-only, so latency SLO color on p99 could be a follow-up).
