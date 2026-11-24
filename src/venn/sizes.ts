// ============================================================
// venn `size:` checks (#1992) — run once the set references resolve.
// ============================================================

import { emit } from '../diagnostics';
import type { ParsedVenn } from '../visualizations/types';
import { VENN_DX } from './diagnostics';

type VennSizeState = Pick<
  ParsedVenn,
  'vennSets' | 'vennOverlaps' | 'proportional' | 'diagnostics'
>;

/**
 * Warn about sizes that cannot be drawn, and clamp an overlap to the
 * smallest set (or smaller overlap) that holds it. Without `proportional`
 * a size is never drawn, so the only check is one warning saying so.
 */
export function checkVennSizes(result: VennSizeState): void {
  const { vennSets, vennOverlaps, diagnostics } = result;
  const lines = [...vennSets, ...vennOverlaps];
  if (!result.proportional) {
    const first = lines
      .filter((l) => l.size != null)
      .sort((a, b) => a.lineNumber - b.lineNumber)[0];
    if (first) diagnostics.push(emit(VENN_DX.SIZE_UNUSED, first.lineNumber));
    return;
  }
  // A line whose size was unreadable already has its warning.
  const invalidLines = new Set(
    diagnostics
      .filter((d) => d.code === VENN_DX.SIZE_INVALID.code)
      .map((d) => d.line)
  );
  for (const s of vennSets) {
    if (s.size == null && !invalidLines.has(s.lineNumber))
      diagnostics.push(
        emit(VENN_DX.SIZE_MISSING, s.lineNumber, { name: s.name })
      );
  }
  const setSize = new Map(vennSets.map((s) => [s.name, s.size]));
  // Pairs first, so a triple is checked against the clamped pairs.
  const ordered = [...vennOverlaps].sort(
    (a, b) => a.sets.length - b.sets.length
  );
  for (const ov of ordered) {
    if (ov.size == null) {
      if (!invalidLines.has(ov.lineNumber))
        diagnostics.push(
          emit(VENN_DX.SIZE_MISSING, ov.lineNumber, {
            name: ov.label ?? ov.sets.join(' + '),
            overlap: true,
          })
        );
      continue;
    }
    let limit = Infinity;
    let limitName = '';
    for (const name of ov.sets) {
      const sz = setSize.get(name);
      if (sz != null && sz < limit) {
        limit = sz;
        limitName = name;
      }
    }
    if (ov.sets.length === 3) {
      for (const pair of vennOverlaps) {
        if (pair.sets.length !== 2 || pair.size == null) continue;
        if (pair.size < limit) {
          limit = pair.size;
          limitName = pair.label ?? pair.sets.join(' + ');
        }
      }
    }
    if (ov.size > limit) {
      diagnostics.push(
        emit(VENN_DX.SIZE_TOO_LARGE, ov.lineNumber, {
          size: ov.size,
          name: limitName,
          limit,
        })
      );
      ov.size = limit;
    }
  }
}
