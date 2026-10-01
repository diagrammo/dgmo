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

/**
 * Put `summary` in a `<desc>` as the root `<svg>`'s first child and point the
 * root's `aria-describedby` at it, so a screen reader reads what the diagram
 * shows after its name. Leaves an SVG that already has `aria-describedby`
 * untouched, and does nothing without a summary.
 *
 * The id is a hash of the SUMMARY, not of the SVG. A map's path coordinates
 * differ in their last digits between macOS and Linux, so an SVG hash gave the
 * same diagram a different id on each, and the gallery baseline — which
 * tolerates that float jitter everywhere else — could never hold on both.
 * Two diagrams with the same summary share an id, and both point at the same
 * words, which is what a reader would hear either way.
 */
export function applyRootDesc(svg: string, summary: string | null): string {
  if (!summary) return svg;
  const m = svg.match(/<svg\b[^>]*>/);
  if (!m) return svg;
  const rootTag = m[0];
  if (/\baria-describedby=/.test(rootTag)) return svg;
  const id = `dgmo-desc-${fnv1a(summary)}`;
  const withDesc =
    rootTag.replace(/^<svg\b/, `<svg aria-describedby="${id}"`) +
    `<desc id="${id}">${escapeAttr(summary)}</desc>`;
  // A function, not a string: the summary carries the author's labels, and a
  // `$&` or `$'` in a replacement STRING splices the root tag or the rest of
  // the document into the <desc>.
  return svg.replace(rootTag, () => withDesc);
}

/** 32-bit FNV-1a, as 8 hex digits. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
