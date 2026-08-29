// ============================================================
// Root <svg> accessibility — one shape for every chart type
// ============================================================
//
// Until 2026-08-28 exactly five of the 106 gallery diagrams carried `role`
// and `aria-label` on the root (bracket, countdown x3, goal); the other
// hundred announced themselves as an unlabelled graphic. Those five each
// build a richer label from their own data (a countdown's hero figure, a
// goal's percentage), so this never overwrites one — it fills the gap for
// every chart that has none.
//
// The label is the chart type, not the diagram's title: the title is drawn
// ad-hoc by each renderer with no shared element or class to read it back
// out of, so a title-aware label would be reliable for some chart types and
// silently absent for the rest — which is the defect this replaces.

/**
 * Add `role="img"` and a chart-type `aria-label` to the root `<svg>` when it
 * carries neither. Leaves an existing `role` or `aria-label` untouched.
 */
export function applyRootA11y(svg: string, chartType?: string | null): string {
  if (!chartType) return svg;
  const m = svg.match(/<svg\b[^>]*>/);
  if (!m) return svg;
  const rootTag = m[0];
  if (/\brole=/.test(rootTag) || /\baria-label=/.test(rootTag)) return svg;
  const label = `${chartType.charAt(0).toUpperCase()}${chartType.slice(1)} diagram`;
  const withA11y = rootTag.replace(
    /^<svg\b/,
    `<svg role="img" aria-label="${escapeAttr(label)}"`
  );
  return svg.replace(rootTag, withA11y);
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
