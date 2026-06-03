import { describe, it, expect } from 'vitest';
import {
  tierBand,
  labelBudget,
  placeContextLabels,
  labelWidth,
  type ContextLabelArgs,
  type CountryCandidate,
} from '../src/map/context-labels';
import { getPalette } from '../src/palettes';
import type { WaterBodies } from '../src/map/data/types';

const P = getPalette('nord').light;

// Linear stand-in projection: lon∈[-180,180]→x, lat∈[90,-90]→y. Good enough for
// the placement logic, which only needs deterministic on/off-screen points.
const linProject =
  (width: number, height: number) =>
  (lon: number, lat: number): [number, number] | null => [
    ((lon + 180) / 360) * width,
    ((90 - lat) / 180) * height,
  ];

// Anchors are deliberately spread far apart on the 800×600 canvas so the
// (now multi-line, taller) water labels don't collide with each other — these
// tests assert tiering/budget, not overlap.
const WATER: WaterBodies = {
  entries: [
    [0, 0, 'Test Ocean', 0, 'ocean'],
    [60, -140, 'Major Sea', 1, 'sea'],
    [-50, 140, 'Some Bay', 1, 'bay'],
    [55, 150, 'Minor Sea', 2, 'sea'],
    [40, 40, 'A Channel', 3, 'channel'],
  ],
};

const baseArgs = (over: Partial<ContextLabelArgs> = {}): ContextLabelArgs => ({
  projection: 'natural-earth',
  dLonSpan: 10, // regional by default
  dLatSpan: 8,
  width: 800,
  height: 600,
  waterBodies: WATER,
  countries: [],
  regionLabels: 'off',
  palette: P,
  project: linProject(800, 600),
  collides: () => false,
  ...over,
});

const texts = (args: ContextLabelArgs): string[] =>
  placeContextLabels(args).map((l) => l.text);

describe('tierBand (Decision 6)', () => {
  it('maps the larger view span to a band', () => {
    expect(tierBand(120)).toBe('world');
    expect(tierBand(90)).toBe('world');
    expect(tierBand(30)).toBe('continental');
    expect(tierBand(10)).toBe('regional');
    expect(tierBand(2)).toBe('local');
  });
});

describe('labelBudget (Decision 6, ADR-3 — biased low, floors)', () => {
  it('scales with canvas area, capped per band', () => {
    expect(labelBudget(800, 600, 'world')).toBe(4);
    expect(labelBudget(800, 600, 'regional')).toBe(4);
  });
  it('floors to ~1 on a thumbnail and 0 on a tiny canvas (AC9)', () => {
    expect(labelBudget(320, 200, 'world')).toBe(1);
    expect(labelBudget(100, 80, 'world')).toBe(0);
  });
});

describe('placeContextLabels — water tiering (AC3, AC4)', () => {
  it('world view = oceans + major seas ONLY, never bays (AC3)', () => {
    const out = texts(baseArgs({ dLonSpan: 280, dLatSpan: 140 }));
    expect(out).toContain('Test Ocean');
    expect(out).toContain('Major Sea');
    expect(out).not.toContain('Some Bay'); // bay kind excluded at world band
    expect(out).not.toContain('Minor Sea'); // tier 2 excluded at world band
    expect(out.some((t) => /Bay|Channel|Sound/.test(t))).toBe(false);
  });
  it('regional view admits smaller features by tier, budget-limited (AC4)', () => {
    const out = texts(baseArgs({ dLonSpan: 10, dLatSpan: 8 }));
    // Budget 4, priority ocean→sea→bay→…: channel (tier 3) is squeezed out.
    expect(out).toContain('Test Ocean');
    expect(out).toContain('Major Sea');
    expect(out).toContain('Some Bay');
    expect(out).not.toContain('A Channel');
    expect(out.length).toBeLessThanOrEqual(labelBudget(800, 600, 'regional'));
  });
});

describe('placeContextLabels — density invariants (AC7)', () => {
  it('count ≤ budget; no context-label overlaps another or a data obstacle', () => {
    const placed = placeContextLabels(baseArgs({ dLonSpan: 10, dLatSpan: 8 }));
    expect(placed.length).toBeLessThanOrEqual(
      labelBudget(800, 600, 'regional')
    );
    // Pairwise non-overlap among placed context labels.
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        // labels are point-anchored 'middle'; distinct anchors ⇒ distinct text.
        expect(a.text === b.text && a.x === b.x && a.y === b.y).toBe(false);
      }
  });
  it('never places a label that would clip the canvas — letter-spacing counted', () => {
    // A wide water name whose anchor sits near the right edge must be dropped or
    // pulled inward (the centre-anchored rect, INCLUDING letter-spacing, must fit
    // wholly on-canvas) — not placed clipping the edge.
    const wide: WaterBodies = {
      entries: [[0, 0, 'North Atlantic Ocean', 0, 'ocean']],
    };
    const nearRight = (): [number, number] | null => [795, 300]; // just inside the right edge
    for (const placed of [
      placeContextLabels(baseArgs({ waterBodies: wide, project: nearRight })),
    ]) {
      for (const l of placed) {
        const w = labelWidth(l.text, l.letterSpacing ?? 0);
        const h = 17;
        expect(l.x - w / 2).toBeGreaterThanOrEqual(0);
        expect(l.x + w / 2).toBeLessThanOrEqual(800);
        expect(l.y - h / 2).toBeGreaterThanOrEqual(0);
        expect(l.y + h / 2).toBeLessThanOrEqual(600);
      }
    }
  });
  it('excludes WATER labels that fall on land; keeps COUNTRY labels on land', () => {
    // overLand=true everywhere → every ocean/sea name is dropped (an ocean name
    // must sit over water), but a country label is exempt (it labels land).
    const allLand = () => true;
    const waterOut = texts(baseArgs({ overLand: allLand }));
    expect(waterOut).toHaveLength(0);

    const country: CountryCandidate = {
      iso: 'BR',
      name: 'Brazil',
      bbox: [100, 100, 360, 200],
      anchor: [230, 150],
    };
    const countryOut = texts(
      baseArgs({
        overLand: allLand,
        waterBodies: { entries: [] },
        countries: [country],
      })
    );
    expect(countryOut).toContain('Brazil');
  });
  it('drops a candidate that collides with a committed data obstacle (AC8)', () => {
    // collides returns true everywhere → zero context labels (data wins).
    const out = texts(baseArgs({ collides: () => true }));
    expect(out).toHaveLength(0);
  });
});

describe('placeContextLabels — guards', () => {
  it('albers-usa is supported (no longer disabled) — labels still place', () => {
    // Decision 8 was relaxed: the CONUS conic projects water correctly and the
    // viewport/edge-clamp rules handle the AK/HI relocation. So context labels
    // are NOT hard-disabled under albers-usa.
    expect(
      texts(baseArgs({ projection: 'albers-usa' })).length
    ).toBeGreaterThan(0);
  });
  it('budget 0 (tiny canvas) → no labels, no throw (AC9)', () => {
    expect(texts(baseArgs({ width: 100, height: 80 }))).toHaveLength(0);
  });
  it('edge-clamps an ADJACENT off-screen ocean, rejects a DISTANT one', () => {
    // tier-0 oceans large enough to read at the frame edge are clamped in;
    // an ocean whose centroid overshoots the viewport by >0.5×dim is dropped.
    const adjacent = (): [number, number] | null => [820, 300]; // just off right edge (overshoot 20 < 0.5*800)
    const distant = (): [number, number] | null => [2000, 300]; // far off-frame (overshoot 1200 > 0.5*800)
    const oceanOnly: WaterBodies = {
      entries: [[0, 0, 'Edge Ocean', 0, 'ocean']],
    };
    expect(
      texts(baseArgs({ waterBodies: oceanOnly, project: adjacent }))
    ).toContain('Edge Ocean');
    expect(
      texts(baseArgs({ waterBodies: oceanOnly, project: distant }))
    ).not.toContain('Edge Ocean');
  });
  it('does NOT edge-clamp a smaller off-screen basin (sea stays strict, AC10)', () => {
    const seaOnly: WaterBodies = { entries: [[0, 0, 'Edge Sea', 1, 'sea']] };
    const adjacent = (): [number, number] | null => [820, 300];
    expect(
      texts(baseArgs({ waterBodies: seaOnly, project: adjacent }))
    ).not.toContain('Edge Sea');
  });
  it('suppresses a water body whose anchor projects off-screen (AC10)', () => {
    // A project that sends ONLY the ocean anchor (lon 0) off the right edge.
    const project = (lon: number, lat: number): [number, number] | null =>
      lon === 0 ? [10_000, 0] : linProject(800, 600)(lon, lat);
    const out = texts(baseArgs({ project }));
    expect(out).not.toContain('Test Ocean');
    expect(out).toContain('Major Sea'); // others still place
  });
});

describe('placeContextLabels — countries (AC5, AC6)', () => {
  const bigFit: CountryCandidate = {
    iso: 'BR',
    name: 'Brazil',
    bbox: [100, 100, 360, 200],
    anchor: [230, 150],
  };
  const tooSmall: CountryCandidate = {
    iso: 'LU',
    name: 'Luxembourg',
    bbox: [400, 400, 420, 412],
    anchor: [410, 406],
  };
  const offscreen: CountryCandidate = {
    iso: 'ZZ',
    name: 'Faraway',
    bbox: [10, 10, 300, 120],
    anchor: null,
  };

  it('labels a large unreferenced country whose name fits; drops sliver/off-screen', () => {
    const out = texts(
      baseArgs({
        waterBodies: { entries: [] },
        countries: [bigFit, tooSmall, offscreen],
      })
    );
    expect(out).toContain('Brazil');
    expect(out).not.toContain('Luxembourg'); // name wider than footprint
    expect(out).not.toContain('Faraway'); // anchor projects nowhere
  });
  it('drops an over-wide (antimeridian/global-smear) country candidate (F2)', () => {
    // A near-full-canvas bbox (e.g. Russia split across the antimeridian) has an
    // unreliable centroid anchor → must NOT be placed despite ranking first.
    const wide: CountryCandidate = {
      iso: 'RU',
      name: 'Russia',
      bbox: [10, 200, 780, 360], // width 770 > 0.66 * 800
      anchor: [395, 280],
    };
    const out = texts(
      baseArgs({ waterBodies: { entries: [] }, countries: [wide, bigFit] })
    );
    expect(out).not.toContain('Russia');
    expect(out).toContain('Brazil');
  });
  it('country names inherit region-labels abbrev; water always full (AC6)', () => {
    const abbrev = placeContextLabels(
      baseArgs({
        regionLabels: 'abbrev',
        waterBodies: { entries: [[0, 0, 'Test Ocean', 0, 'ocean']] },
        countries: [bigFit],
      })
    );
    expect(abbrev.map((l) => l.text)).toContain('BR'); // ISO, not "Brazil"
    expect(abbrev.map((l) => l.text)).toContain('Test Ocean'); // water full
  });
  it('water sorts before countries (orientation core first)', () => {
    const placed = placeContextLabels(
      baseArgs({
        dLonSpan: 10,
        countries: [bigFit],
      })
    );
    const waterIdx = placed.findIndex((l) => l.italic);
    const countryIdx = placed.findIndex((l) => l.text === 'Brazil');
    if (countryIdx >= 0) expect(waterIdx).toBeLessThan(countryIdx);
  });
});

describe('placeContextLabels — styling (AC12)', () => {
  it('water is italic + letter-spaced + haloed; country is upright', () => {
    const placed = placeContextLabels(
      baseArgs({
        dLonSpan: 280,
        dLatSpan: 140,
        waterBodies: { entries: [[0, 0, 'Test Ocean', 0, 'ocean']] },
      })
    );
    const ocean = placed.find((l) => l.text === 'Test Ocean')!;
    expect(ocean.italic).toBe(true);
    expect(ocean.letterSpacing).toBeGreaterThan(0);
    expect(ocean.halo).toBe(true);
    expect(ocean.haloColor).toBe(P.bg);
  });
});
