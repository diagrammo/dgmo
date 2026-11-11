// ============================================================
// Glyph registry — bundled icon sets any chart type can draw (#1845)
// ============================================================
//
// Owner's decision, 2026-11-10: bundled icon sets only. Nothing user-supplied
// and no images by URL. Each glyph is a line icon in a GLYPH_VIEWBOX-unit
// square, drawn as stroked paths with no fill, so it takes any theme colour.
// The paths are the approved mockup's
// (diagrammo-ecosystem-docs mockups/2026-11-10-whiteboard-shape-sets).
//
// The whiteboard reads this first: a `shapes <set>` line turns a set on for
// one file. A set whose glyphs a chart already draws as its own shapes
// (database, queue, file on the whiteboard) leaves them out.

/** Side of the square every glyph is drawn in, in glyph units. */
export const GLYPH_VIEWBOX = 20;

/** Stroke width every glyph is designed at, in glyph units. */
export const GLYPH_STROKE = 1.5;

/** A rounded rectangle as a path. */
function rr(x: number, y: number, w: number, h: number, r = 0): string {
  if (r === 0) return `M${x} ${y}h${w}v${h}h${-w}z`;
  const a = `a${r} ${r} 0 0 1`;
  return (
    `M${x + r} ${y}h${w - 2 * r}${a} ${r} ${r}v${h - 2 * r}${a} ${-r} ${r}` +
    `h${-(w - 2 * r)}${a} ${-r} ${-r}v${-(h - 2 * r)}${a} ${r} ${-r}z`
  );
}

/** A circle as a path. */
function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
}

/** A glyph's source keyword (`router`, `access-point`). */
export type GlyphName =
  | 'router'
  | 'switch'
  | 'firewall'
  | 'server'
  | 'access-point'
  | 'cloud'
  | 'globe'
  | 'lock'
  | 'user'
  | 'users'
  | 'laptop'
  | 'mobile'
  | 'storage';

/** Every glyph's stroked paths, keyed by its source keyword. */
const GLYPH_PATHS: Record<GlyphName, readonly string[]> = {
  router: [circle(10, 10, 6.5), 'M6.5 10h7M11.5 8l2 2-2 2M10 6.5v7'],
  switch: [
    rr(3, 6.5, 14, 7, 1.5),
    'M6 10h8M12 8.5l2 1.5-2 1.5M8 8.5L6 10l2 1.5',
  ],
  firewall: [
    rr(3.5, 4.5, 13, 11),
    'M3.5 8.2h13M3.5 11.8h13M8 4.5v3.7M12 8.2v3.6M8 11.8v3.7',
  ],
  server: [
    rr(4.5, 3.5, 11, 5.5, 1),
    rr(4.5, 11, 11, 5.5, 1),
    'M7 6.2h.1M7 13.8h.1',
  ],
  'access-point': [
    'M10 15v-4',
    circle(10, 10, 1),
    'M7 7.5a4 4 0 0 1 6 0M5 5.5a7 7 0 0 1 10 0',
    'M6.5 16h7',
  ],
  cloud: ['M6 15h8.5a3 3 0 0 0 0-6 4.5 4.5 0 0 0-8.6-1A3.5 3.5 0 0 0 6 15z'],
  globe: [
    circle(10, 10, 6.5),
    'M3.5 10h13M10 3.5c-3 3.5-3 9.5 0 13M10 3.5c3 3.5 3 9.5 0 13',
  ],
  lock: [rr(5, 9, 10, 7.5, 1.2), 'M7 9V7a3 3 0 0 1 6 0v2'],
  user: [circle(10, 7, 3), 'M4.5 16.5a5.5 5.5 0 0 1 11 0'],
  users: [
    circle(8, 7.5, 2.5),
    'M3.5 16a4.5 4.5 0 0 1 9 0',
    'M12.5 5.5a2.5 2.5 0 0 1 0 4.5M14 12a4.5 4.5 0 0 1 2.5 4',
  ],
  laptop: [rr(5, 5, 10, 7, 1), 'M3 15h14'],
  mobile: [rr(6.5, 3, 7, 14, 1.5), 'M9.5 14.5h1'],
  storage: [
    rr(3.5, 5, 13, 4, 1),
    rr(3.5, 11, 13, 4, 1),
    'M13.5 7h.1M13.5 13h.1',
  ],
};

/** A bundled set: its `shapes` id, its display name, and its glyphs in order. */
export interface GlyphSet {
  readonly id: string;
  readonly label: string;
  readonly glyphs: readonly GlyphName[];
}

/** Every bundled set, in picker order. */
export const GLYPH_SETS: readonly GlyphSet[] = [
  {
    id: 'network',
    label: 'Network',
    glyphs: [
      'router',
      'switch',
      'firewall',
      'server',
      'access-point',
      'cloud',
      'globe',
      'lock',
      'user',
      'users',
      'laptop',
      'mobile',
      'storage',
    ],
  },
];

const SET_OF = new Map<string, GlyphSet>(
  GLYPH_SETS.flatMap((s) => s.glyphs.map((g) => [g, s] as const))
);

/** Every glyph keyword, in set order. */
export const GLYPH_NAMES: readonly GlyphName[] = GLYPH_SETS.flatMap(
  (s) => s.glyphs
);

export function isGlyphName(value: string): value is GlyphName {
  return SET_OF.has(value);
}

/** The set a glyph belongs to. */
export function glyphSetOf(name: GlyphName): GlyphSet {
  return SET_OF.get(name)!;
}

/** The set with this `shapes` id, if one is bundled. */
export function glyphSetById(id: string): GlyphSet | undefined {
  return GLYPH_SETS.find((s) => s.id === id);
}

/** A glyph's stroked paths, in GLYPH_VIEWBOX units. */
export function glyphPaths(name: GlyphName): readonly string[] {
  return GLYPH_PATHS[name];
}
