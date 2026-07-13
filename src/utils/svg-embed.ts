/**
 * Make an SVG produced by `@diagrammo/dgmo`'s static `render()` suitable for
 * responsive inline embedding in any host (Obsidian, remark/markdown, web
 * pages):
 *
 * - dgmo renders diagrams inside a fixed export canvas (e.g.
 *   `viewBox="0 0 1200 800"`), with content often occupying only a fraction
 *   of it. We compute a tight content bounding box from element coordinates
 *   and set the root `viewBox` to bbox+padding, so the diagram's intrinsic
 *   aspect ratio matches its CONTENT — no dead space above/below or beside it.
 * - Ensure the root `<svg>` has a `viewBox` so it scales responsively.
 * - Strip fixed `width="N"` / `height="N"` so CSS (e.g. `width:100%;
 *   height:auto`, or an aspect-ratio derived from the tight viewBox) controls
 *   sizing.
 * - The root inline `background:` (the theme's opaque `palette.bg`) is
 *   PRESERVED: every chart type now carries its own opaque background so
 *   diagrams render consistently across hosts and color modes rather than
 *   inheriting an arbitrary host page background.
 *
 * This is intentionally a string transform, not a DOM `getBBox()` step: dgmo
 * can dual-render light/dark SVGs where one is hidden by color-mode CSS, and
 * `getBBox()` returns 0 for the hidden copy. Parsing coordinates from the
 * markup measures both copies reliably and works server-side (Node).
 */
export function normalizeSvgForEmbed(input: string): string {
  let svg = input;
  const rootMatch = svg.match(/<svg[^>]*>/);
  const rootTag = rootMatch?.[0] ?? '';
  if (rootTag && !rootTag.includes('viewBox')) {
    const wh = rootTag.match(/width="(\d+)"[^>]*height="(\d+)"/);
    if (wh) {
      svg = svg.replace(/<svg/, `<svg viewBox="0 0 ${wh[1]} ${wh[2]}"`);
    }
  }

  const tight = computeBBox(svg);
  if (tight && tight.width > 0 && tight.height > 0) {
    const pad = 16;
    const x = tight.x - pad;
    const y = tight.y - pad;
    const w = tight.width + pad * 2;
    const h = tight.height + pad * 2;
    // The renderer's viewBox is authoritative; computeBBox may only shave dead
    // margins off it. computeBBox is a best-effort string parser with two
    // failure modes, and the renderer's canvas bounds catch both:
    //   1. OVER-shoot — it misreads path arc commands (`A rx ry rot … x y`) and
    //      yields a box that strays OUTSIDE the canvas (negative origin /
    //      over-wide). Applying it shifts the viewBox and CLIPS the diagram.
    //   2. UNDER-shoot — it can't see elements positioned via `transform`
    //      (no x/y attrs), e.g. word-cloud words. It then measures only the
    //      stragglers (the title) and collapses the box to a tiny region,
    //      zooming that fragment to fill the frame.
    // So only tighten when the computed box sits WITHIN the canvas AND still
    // covers most of it; otherwise keep the renderer's correct bounds.
    const canvas = readViewBox(svg);
    const TOL = 2;
    const MIN_COVERAGE = 0.5; // a real trim shaves margins, not the diagram
    const trustworthy =
      !canvas ||
      (x >= canvas.x - TOL &&
        y >= canvas.y - TOL &&
        x + w <= canvas.x + canvas.width + TOL &&
        y + h <= canvas.y + canvas.height + TOL &&
        w >= canvas.width * MIN_COVERAGE &&
        h >= canvas.height * MIN_COVERAGE);
    if (trustworthy) {
      const vb = `${x} ${y} ${w} ${h}`;
      svg = svg.replace(/(<svg[^>]*?)viewBox="[^"]*"/, `$1viewBox="${vb}"`);
    }
  }

  svg = svg.replace(/(<svg[^>]*?) width="[^"]*"/g, '$1');
  svg = svg.replace(/(<svg[^>]*?) height="[^"]*"/g, '$1');
  svg = svg.replace(/<svg\s{2,}/g, '<svg ');
  return svg;
}

/**
 * Parse the content bounding box of a normalized embed SVG, if one can be
 * derived. Returns `null` when no usable coordinates are found (e.g. an empty
 * diagram). Useful for hosts that want to set an explicit `aspect-ratio` from
 * the tight viewBox.
 */
export function getEmbedSvgViewBox(
  svg: string
): { x: number; y: number; width: number; height: number } | null {
  const tight = computeBBox(svg);
  if (!tight || tight.width <= 0 || tight.height <= 0) return null;
  const pad = 16;
  return {
    x: tight.x - pad,
    y: tight.y - pad,
    width: tight.width + pad * 2,
    height: tight.height + pad * 2,
  };
}

/** Read the root `<svg>` viewBox as numbers, if present and well-formed. */
function readViewBox(
  svg: string
): { x: number; y: number; width: number; height: number } | null {
  const m = svg.match(/<svg[^>]*?\bviewBox="([^"]+)"/);
  if (!m) return null;
  const n = m[1]!
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    n.length !== 4 ||
    n.some((v) => !Number.isFinite(v)) ||
    n[2]! <= 0 ||
    n[3]! <= 0
  )
    return null;
  return { x: n[0]!, y: n[1]!, width: n[2]!, height: n[3]! };
}

/**
 * Compute an approximate content bounding box from raw element coordinates.
 *
 * This is a regex walk, not a real SVG layout — it ignores `transform`
 * attributes and uses a heuristic for text widths. dgmo's renderers mostly use
 * absolute coordinates within their viewBox, so the approximation is close
 * enough that the rendered output reliably fills the visible area.
 */
function computeBBox(
  svg: string
): { x: number; y: number; width: number; height: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];

  function push(x: number, y: number): void {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x);
      ys.push(y);
    }
  }

  function attr(tag: string, name: string): number | null {
    const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
    if (!m) return null;
    const n = parseFloat(m[1]!);
    return Number.isFinite(n) ? n : null;
  }

  // <rect x y width height>
  for (const m of svg.matchAll(/<rect\b[^>]*?\/?>/g)) {
    const tag = m[0];
    const x = attr(tag, 'x');
    const y = attr(tag, 'y');
    const w = attr(tag, 'width');
    const h = attr(tag, 'height');
    if (x !== null && y !== null && w !== null && h !== null) {
      push(x, y);
      push(x + w, y + h);
    }
  }

  // <line x1 y1 x2 y2>
  for (const m of svg.matchAll(/<line\b[^>]*?\/?>/g)) {
    const tag = m[0];
    const x1 = attr(tag, 'x1');
    const y1 = attr(tag, 'y1');
    const x2 = attr(tag, 'x2');
    const y2 = attr(tag, 'y2');
    if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
      push(x1, y1);
      push(x2, y2);
    }
  }

  // <circle cx cy r>
  for (const m of svg.matchAll(/<circle\b[^>]*?\/?>/g)) {
    const tag = m[0];
    const cx = attr(tag, 'cx');
    const cy = attr(tag, 'cy');
    const r = attr(tag, 'r');
    if (cx !== null && cy !== null && r !== null) {
      push(cx - r, cy - r);
      push(cx + r, cy + r);
    }
  }

  // <ellipse cx cy rx ry>
  for (const m of svg.matchAll(/<ellipse\b[^>]*?\/?>/g)) {
    const tag = m[0];
    const cx = attr(tag, 'cx');
    const cy = attr(tag, 'cy');
    const rx = attr(tag, 'rx');
    const ry = attr(tag, 'ry');
    if (cx !== null && cy !== null && rx !== null && ry !== null) {
      push(cx - rx, cy - ry);
      push(cx + rx, cy + ry);
    }
  }

  // <text x y>some content</text>
  // Extent is FONT-SIZE-aware: a fixed guess (e.g. ~14px tall, ~7px/char)
  // clips large text — the countdown hero (96px) and title (40px) tower far
  // above a baseline−14 top, so a fixed box crops their caps when the embed
  // viewBox is tightened. Scale both axes off the tag's font-size instead.
  for (const m of svg.matchAll(/<text\b([^>]*?)>([\s\S]*?)<\/text>/g)) {
    const tag = `<text${m[1]}>`;
    const text = m[2]!.replace(/<[^>]+>/g, ''); // strip inner tags (tspan, etc.)
    const x = attr(tag, 'x');
    const y = attr(tag, 'y');
    if (x !== null && y !== null) {
      const fontSize =
        attr(tag, 'font-size') ??
        (() => {
          const s = tag.match(/font-size:\s*([\d.]+)/);
          return s ? parseFloat(s[1]!) : 14;
        })();
      const w = text.length * fontSize * 0.5; // ~0.5em/char (the old 7px @14px)
      // Honor text-anchor so the horizontal extent points the right way:
      // `start` (SVG default) grows rightward from x, `end` grows leftward,
      // `middle` straddles x. Assuming middle for everything under-measures
      // start-anchored text (e.g. pyramid right-column descriptions), which
      // collapses the tight viewBox and clips that text in embeds.
      const anchor = tag.match(/\btext-anchor="([^"]*)"/)?.[1] ?? 'start';
      const left =
        anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
      const right =
        anchor === 'middle' ? x + w / 2 : anchor === 'end' ? x : x + w;
      // Ascent above baseline ≈ 0.9em (caps + a little slack for round tops);
      // descent below ≈ 0.25em. Generalizes the old fixed 14/4 at 14px.
      push(left, y - fontSize * 0.9);
      push(right, y + fontSize * 0.25);
    }
  }

  // <path d="..."> — pull every coordinate pair out of the d attribute.
  // Skip paths flagged `data-embed-ignore-bbox`: decorative micro-glyphs drawn
  // in a local coord space under a `transform` (e.g. the countdown recurring
  // icon), whose raw 0–N coords don't map to diagram space.
  for (const m of svg.matchAll(/<path\b[^>]*?>/g)) {
    const tag = m[0];
    if (tag.includes('data-embed-ignore-bbox')) continue;
    const dm = tag.match(/\bd="([^"]+)"/);
    if (!dm) continue;
    const d = dm[1]!;
    const nums = d.match(/-?\d+(?:\.\d+)?/g);
    if (!nums) continue;
    for (let i = 0; i + 1 < nums.length; i += 2) {
      push(parseFloat(nums[i]!), parseFloat(nums[i + 1]!));
    }
  }

  // <polygon points="x,y x,y ..."> and <polyline>
  for (const m of svg.matchAll(
    /<(?:polygon|polyline)\b[^>]*?\bpoints="([^"]+)"/g
  )) {
    const nums = m[1]!.match(/-?\d+(?:\.\d+)?/g);
    if (!nums) continue;
    for (let i = 0; i + 1 < nums.length; i += 2) {
      push(parseFloat(nums[i]!), parseFloat(nums[i + 1]!));
    }
  }

  if (xs.length === 0 || ys.length === 0) return null;

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
