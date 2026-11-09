// ============================================================
// Shared shape geometry (#1760)
// ============================================================
//
// One definition per symbol that more than one chart type draws. Each shape
// gives its SVG path and its outline as convex pieces whose UNION is the drawn
// shape — the pieces are what hit tests and connector clipping use, so they
// stay in step with the path by living beside it.
//
// Pure: no DOM, no constants. Every function takes a top-left `x y`, a size,
// and the shape's one tuning number (wave depth, cap size); each caller keeps
// its own value (`shape-caps.ts`, flowchart's `DOC_WAVE_HEIGHT`).
//
// 🔴 Output strings are byte-identical to the per-chart code they replaced.
// A centred caller passes `x = -w/2, y = -h/2`; every expression below is
// written so that `x + w` and `y + h` come out exact for that case
// (`w - w/2` is exact). Rewriting `(x + w) - w * 0.25` as `x + w * 0.75` is NOT
// a no-op — it drifts the last bit of fractional widths and every snapshot.

export interface ShapePoint {
  readonly x: number;
  readonly y: number;
}

/** One convex piece of an outline. */
export type ShapePiece =
  | {
      readonly kind: 'rect';
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
    }
  | {
      readonly kind: 'ellipse';
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
    }
  | {
      /** A convex polygon, corners clockwise on screen (y down). */
      readonly kind: 'poly';
      readonly pts: readonly ShapePoint[];
    };

/** Collapse tolerance for sampled pieces, px. */
const EPS = 1e-6;

/** An axis-aligned rectangle piece; none when it is inside out. */
export function rectPiece(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): ShapePiece[] {
  return x1 >= x0 && y1 >= y0 ? [{ kind: 'rect', x0, y0, x1, y1 }] : [];
}

/** An ellipse piece; none when either radius is zero. */
export function ellipsePiece(
  cx: number,
  cy: number,
  rx: number,
  ry: number
): ShapePiece[] {
  return rx > 0 && ry > 0 ? [{ kind: 'ellipse', cx, cy, rx, ry }] : [];
}

// ── Document (a page with one wave for its bottom edge) ─────
// Flowchart `document`, whiteboard `file`.

/** Steps the wavy bottom is sampled in, for clipping and hit tests. */
export const DOCUMENT_WAVE_STEPS = 16;

/**
 * A document's outline: straight top and sides, and a bottom that is one cubic
 * wave of depth `wave`, dipping below the baseline on the right and rising
 * above it on the left.
 */
export function documentPath(
  x: number,
  y: number,
  w: number,
  h: number,
  wave: number
): string {
  const right = x + w;
  const b = y + h - wave;
  return (
    `M ${x} ${y} L ${right} ${y} L ${right} ${b} ` +
    `C ${right - w * 0.25} ${b + wave * 2}, ${x + w * 0.25} ${b - wave}, ${x} ${b} Z`
  );
}

/** Points along the cubic `documentPath` draws, right to left. */
export function documentWavePoints(
  x: number,
  y: number,
  w: number,
  h: number,
  wave: number,
  steps = DOCUMENT_WAVE_STEPS
): ShapePoint[] {
  const right = x + w;
  const b = y + h - wave;
  const xs = [right, right - w * 0.25, x + w * 0.25, x];
  const ys = [b, b + wave * 2, b - wave, b];
  const out: ShapePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    out.push({
      x: k[0]! * xs[0]! + k[1]! * xs[1]! + k[2]! * xs[2]! + k[3]! * xs[3]!,
      y: k[0]! * ys[0]! + k[1]! * ys[1]! + k[2]! * ys[2]! + k[3]! * ys[3]!,
    });
  }
  return out;
}

/**
 * A document as convex pieces: the body down to the wave's highest point,
 * then one strip per sampled step, each running down to the wave.
 */
export function documentPieces(
  x: number,
  y: number,
  w: number,
  h: number,
  wave: number
): ShapePiece[] {
  const pts = documentWavePoints(x, y, w, h, wave);
  const top = Math.min(...pts.map((p) => p.y));
  const strips: ShapePiece[] = [];
  for (let i = pts.length - 1; i > 0; i--) {
    const a = pts[i]!;
    const b = pts[i - 1]!;
    if (b.x - a.x < EPS || Math.max(a.y, b.y) - top < EPS) continue;
    strips.push({
      kind: 'poly',
      pts: [
        { x: a.x, y: top },
        { x: b.x, y: top },
        { x: b.x, y: Math.max(b.y, top) },
        { x: a.x, y: Math.max(a.y, top) },
      ],
    });
  }
  return [...rectPiece(x, y, x + w, top), ...strips];
}

// ── Cylinder (standing: database, cache) ────────────────────
// C4 `database`/`cache`, whiteboard `database`.

/**
 * A standing cylinder's outline: the sides from `y + ry` to `y + h - ry`, the
 * top cap's far half and the bottom cap's near half, both `w/2 × ry`.
 */
export function cylinderPath(
  x: number,
  y: number,
  w: number,
  h: number,
  ry: number
): string {
  const right = x + w;
  const top = y + ry;
  const bottom = y + h - ry;
  return [
    `M ${x} ${top}`,
    `A ${w / 2} ${ry} 0 0 1 ${right} ${top}`,
    `L ${right} ${bottom}`,
    `A ${w / 2} ${ry} 0 0 1 ${x} ${bottom}`,
    'Z',
  ].join(' ');
}

/** The full top cap ellipse drawn over `cylinderPath` to close its rim. */
export function cylinderTopCap(
  x: number,
  y: number,
  w: number,
  ry: number
): { cx: number; cy: number; rx: number; ry: number } {
  return { cx: x + w / 2, cy: y + ry, rx: w / 2, ry };
}

/** A standing cylinder as convex pieces: the body plus both cap ellipses. */
export function cylinderPieces(
  x: number,
  y: number,
  w: number,
  h: number,
  ry: number
): ShapePiece[] {
  const cx = x + w / 2;
  return [
    ...rectPiece(x, y + ry, x + w, y + h - ry),
    ...ellipsePiece(cx, y + ry, w / 2, ry),
    ...ellipsePiece(cx, y + h - ry, w / 2, ry),
  ];
}

// ── Queue (a cylinder on its side) ──────────────────────────
// C4 `queue`, whiteboard `queue`.

/** A queue's outline: a body between two end caps of half-width `cap`. */
export function queuePath(
  x: number,
  y: number,
  w: number,
  h: number,
  cap: number
): string {
  const xL = x + cap;
  const xR = x + w - cap;
  const bottom = y + h;
  const ry = h / 2;
  return [
    `M ${xL} ${y}`,
    `L ${xR} ${y}`,
    `A ${cap} ${ry} 0 0 1 ${xR} ${bottom}`,
    `L ${xL} ${bottom}`,
    `A ${cap} ${ry} 0 0 1 ${xL} ${y}`,
    'Z',
  ].join(' ');
}

/**
 * The near cap: an arc bulging INTO the body, which is what makes the queue
 * read as a pipe seen end-on rather than a lozenge.
 *
 * 🔴 Sweep 1 while going DOWN. The outline's own left cap is also sweep 1 but
 * travels UP, so it bulges the other way; with sweep 0 this arc lands exactly
 * on top of it and disappears.
 */
export function queueNearCapPath(
  x: number,
  y: number,
  h: number,
  cap: number
): string {
  const xL = x + cap;
  return `M ${xL} ${y} A ${cap} ${h / 2} 0 0 1 ${xL} ${y + h}`;
}

/** A queue as convex pieces: the body plus both cap ellipses. */
export function queuePieces(
  x: number,
  y: number,
  w: number,
  h: number,
  cap: number
): ShapePiece[] {
  const cy = y + h / 2;
  return [
    ...rectPiece(x + cap, y, x + w - cap, y + h),
    ...ellipsePiece(x + cap, cy, cap, h / 2),
    ...ellipsePiece(x + w - cap, cy, cap, h / 2),
  ];
}

// ── Diamond ─────────────────────────────────────────────────
// Flowchart `decision`, gantt milestone, swimlane gateway, class
// aggregation/composition markers.

/**
 * A diamond's corners as SVG `points`, top, right, bottom, left, centred on
 * `cx cy` with half-width `hw` and half-height `hh`.
 */
export function diamondPoints(
  cx: number,
  cy: number,
  hw: number,
  hh: number
): string {
  return `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`;
}

// ── Parallelogram ───────────────────────────────────────────
// Flowchart `io`.

/**
 * A parallelogram's corners as SVG `points`, centred on `cx cy`: the top edge
 * shifted right by `skew` and the bottom edge left by it.
 */
export function parallelogramPoints(
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  skew: number
): string {
  return [
    `${cx - hw + skew},${cy - hh}`,
    `${cx + hw + skew},${cy - hh}`,
    `${cx + hw - skew},${cy + hh}`,
    `${cx - hw - skew},${cy + hh}`,
  ].join(' ');
}

// ── Cloud ───────────────────────────────────────────────────
// C4 `cloud`.

/**
 * The radius of a circular arc with chord `chord` bulging `sag` past it.
 * Lobes are specified by how far they bulge, which has to stay constant as a
 * card grows — a fixed radius would make a wide card's lobes shallow.
 */
function arcRadius(chord: number, sag: number): number {
  return (chord * chord) / 4 / (2 * sag) + sag / 2;
}

/**
 * A cloud's outline: eight lobes — three along the top, three along the
 * bottom, one per side — each bulging `bump` outward from a chord inset by
 * `bump`, so the outline touches the box's edges and never leaves them.
 */
export function cloudPath(
  x: number,
  y: number,
  w: number,
  h: number,
  bump: number
): string {
  const xL = x + bump;
  const xR = x + w - bump;
  const yTop = y + bump;
  const yBot = y + h - bump;
  const topChord = (xR - xL) / 3;
  const rTop = arcRadius(topChord, bump);
  const rSide = arcRadius(yBot - yTop, bump);
  // Sweep 1 throughout: the path runs clockwise, so every arc bulges away
  // from the middle without needing a per-edge flag.
  return [
    `M ${xL} ${yTop}`,
    `A ${rTop} ${rTop} 0 0 1 ${xL + topChord} ${yTop}`,
    `A ${rTop} ${rTop} 0 0 1 ${xL + topChord * 2} ${yTop}`,
    `A ${rTop} ${rTop} 0 0 1 ${xR} ${yTop}`,
    `A ${rSide} ${rSide} 0 0 1 ${xR} ${yBot}`,
    `A ${rTop} ${rTop} 0 0 1 ${xL + topChord * 2} ${yBot}`,
    `A ${rTop} ${rTop} 0 0 1 ${xL + topChord} ${yBot}`,
    `A ${rTop} ${rTop} 0 0 1 ${xL} ${yBot}`,
    `A ${rSide} ${rSide} 0 0 1 ${xL} ${yTop}`,
    'Z',
  ].join(' ');
}
