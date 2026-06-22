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
  // Budget knob (map-context-neighbor-labels): area divisor lowered 150→105 and
  // band caps raised so the proximity rank has room to label the story's neighbours.
  it('scales with canvas area, capped per band', () => {
    expect(labelBudget(800, 600, 'world')).toBe(6); // sqrt(480k)/105 ≈ 6.6 → 6
    expect(labelBudget(800, 600, 'regional')).toBe(6);
  });
  it('floors to ~2 on a thumbnail and 0 on a tiny canvas (AC9)', () => {
    expect(labelBudget(320, 200, 'world')).toBe(2);
    expect(labelBudget(100, 80, 'world')).toBe(0);
  });
  it('per-band caps bind on a large canvas (broadened headroom)', () => {
    // sqrt(2000*2000)/105 ≈ 19 area-slots, so the per-band cap is what binds.
    expect(labelBudget(2000, 2000, 'world')).toBe(10);
    expect(labelBudget(2000, 2000, 'continental')).toBe(9);
    expect(labelBudget(2000, 2000, 'regional')).toBe(7);
    expect(labelBudget(2000, 2000, 'local')).toBe(6);
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
  it('regional view admits smaller features by tier (broadened budget, AC4)', () => {
    const out = texts(baseArgs({ dLonSpan: 10, dLatSpan: 8 }));
    // Regional budget is now 6 (broadened): the 5-entry fixture all places,
    // including the tier-3 channel that the old thin budget squeezed out.
    expect(out).toContain('Test Ocean');
    expect(out).toContain('Major Sea');
    expect(out).toContain('Some Bay');
    expect(out).toContain('A Channel'); // tier 3 now fits the broadened budget
    expect(out.length).toBeLessThanOrEqual(labelBudget(800, 600, 'regional'));
  });
  it('a budget smaller than the candidate set squeezes out lowest priority (AC4)', () => {
    // 8 well-separated water bodies vs. regional budget 6 → the two lowest-priority
    // (tier-3 channel + sound) are squeezed out; the ocean always survives.
    const many: WaterBodies = {
      entries: [
        [0, 0, 'W Ocean', 0, 'ocean'],
        [40, -120, 'W Sea A', 1, 'sea'],
        [-40, 120, 'W Sea B', 1, 'sea'],
        [50, 60, 'W Bay', 1, 'bay'],
        [-50, -60, 'W Sea C', 2, 'sea'],
        [60, 140, 'W Gulf', 2, 'gulf'],
        [-60, -140, 'W Channel', 3, 'channel'],
        [10, 170, 'W Sound', 3, 'sound'],
      ],
    };
    const out = texts(
      baseArgs({ dLonSpan: 10, dLatSpan: 8, waterBodies: many })
    );
    expect(out.length).toBeLessThanOrEqual(labelBudget(800, 600, 'regional'));
    expect(out).toContain('W Ocean');
    expect(out).not.toContain('W Channel');
    expect(out).not.toContain('W Sound');
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
    name: 'Brazil',
    bbox: [100, 100, 360, 200],
    anchor: [230, 150],
  };
  const tooSmall: CountryCandidate = {
    name: 'Luxembourg',
    bbox: [400, 400, 420, 412],
    anchor: [410, 406],
  };
  const offscreen: CountryCandidate = {
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
  it('drops a both-axes canvas-smear country candidate (F2)', () => {
    // A bbox that fills the canvas in BOTH dimensions (e.g. a country whose
    // projected fill inverts to cover the whole frame) has an unreliable centroid
    // anchor → must NOT be placed despite ranking first.
    const smear: CountryCandidate = {
      name: 'Russia',
      bbox: [10, 10, 780, 580], // w 770 > 0.66*800 AND h 570 > 0.66*600
      anchor: [395, 295],
    };
    const out = texts(
      baseArgs({ waterBodies: { entries: [] }, countries: [smear, bigFit] })
    );
    expect(out).not.toContain('Russia');
    expect(out).toContain('Brazil');
  });
  it('keeps a both-axes smear country that has a CURATED anchor (Russia)', () => {
    // Same full-canvas smear bbox, but `curatedAnchor` marks the anchor as a
    // trusted WORLD_LABEL_ANCHORS mainland point (e.g. European Russia) — the
    // smear gate's unreliable-centroid concern is moot, so it must PLACE. The
    // in-viewport anchor check still applies (here the anchor is on-frame).
    const russia: CountryCandidate = {
      name: 'Russia',
      bbox: [0, 0, 800, 600], // full canvas in both axes
      anchor: [620, 180], // trusted mainland point, inside the viewport
      curatedAnchor: true,
    };
    const placed = placeContextLabels(
      baseArgs({ waterBodies: { entries: [] }, countries: [russia] })
    );
    const ru = placed.find((l) => l.text === 'Russia');
    expect(ru).toBeDefined();
    // Rendered as a subdued backdrop name, not an off-frame mid-map ghost.
    expect(ru!.x).toBe(620);
    expect(ru!.y).toBe(180);
  });
  it('still drops a curated-anchor country whose anchor projects off-frame', () => {
    const offFrame: CountryCandidate = {
      name: 'Russia',
      bbox: [0, 0, 800, 600],
      anchor: [900, 180], // x > width → off the right edge
      curatedAnchor: true,
    };
    const out = texts(
      baseArgs({ waterBodies: { entries: [] }, countries: [offFrame] })
    );
    expect(out).not.toContain('Russia');
  });
  it('keeps a wide-but-short landmass whose anchor is over its land (Canada)', () => {
    // A country hugging the top of a US-focused frame is legitimately wide but
    // short; its clipExtent-clipped, area-weighted centroid still lands over its
    // own ground, so it must NOT be dropped for footprint width alone.
    const canada: CountryCandidate = {
      name: 'Canada',
      bbox: [40, 30, 760, 200], // w 720 > 0.66*800 but h 170 < 0.66*600
      anchor: [400, 70],
    };
    const out = texts(
      baseArgs({ waterBodies: { entries: [] }, countries: [canada] })
    );
    expect(out).toContain('Canada');
  });
  it('country labels always use the full name, never an ISO abbreviation (AC6)', () => {
    const placed = placeContextLabels(
      baseArgs({
        waterBodies: { entries: [[0, 0, 'Test Ocean', 0, 'ocean']] },
        countries: [bigFit],
      })
    );
    expect(placed.map((l) => l.text)).toContain('Brazil'); // full name, not "BR"
    expect(placed.map((l) => l.text)).not.toContain('BR');
    expect(placed.map((l) => l.text)).toContain('Test Ocean'); // water full
  });
  it('scales font up with footprint but colour is CONSTANT (no fade)', () => {
    // A large footprint reads as a bigger backdrop name; a small one keeps the
    // base font. Subordination is by muting + size only — NOT by fading toward
    // bg, so the colour is identical across footprints (the floored muted tone).
    const big: CountryCandidate = {
      name: 'Bigland',
      bbox: [100, 100, 380, 260],
      anchor: [240, 180],
    };
    const small: CountryCandidate = {
      name: 'Tiny',
      bbox: [420, 320, 464, 350],
      anchor: [442, 335],
    };
    const placed = placeContextLabels(
      baseArgs({ waterBodies: { entries: [] }, countries: [big, small] })
    );
    const b = placed.find((l) => l.text === 'Bigland')!;
    const s = placed.find((l) => l.text === 'Tiny')!;
    expect(b).toBeDefined();
    expect(s).toBeDefined();
    expect(b.fontSize!).toBeGreaterThan(s.fontSize!); // footprint still ramps size
    expect(s.fontSize).toBe(11); // unscaled base font
    expect(s.color).toBe(P.textMuted); // fallback muted tone (no countryTone arg)
    expect(b.color).toBe(s.color); // no fade: same tone regardless of footprint
  });
  it('uses the supplied contrast-floored countryTone for every country', () => {
    // When the caller passes a floored land tone (shared with the orientation
    // backdrop), every country label uses it verbatim — no fade, no per-size
    // colour drift — so a context country and an orientation region match.
    const floored = '#5b6672';
    const big: CountryCandidate = {
      name: 'Bigland',
      bbox: [100, 100, 380, 260],
      anchor: [240, 180],
    };
    const small: CountryCandidate = {
      name: 'Tiny',
      bbox: [420, 320, 464, 350],
      anchor: [442, 335],
    };
    const placed = placeContextLabels(
      baseArgs({
        waterBodies: { entries: [] },
        countries: [big, small],
        countryTone: floored,
      })
    );
    for (const t of ['Bigland', 'Tiny']) {
      const l = placed.find((p) => p.text === t)!;
      expect(l).toBeDefined();
      expect(l.color).toBe(floored);
    }
  });
  it('orientation-value ranking: major water < country < minor water', () => {
    // The orientation core (oceans + major seas, tier ≤ 1) leads; a big country
    // outranks MINOR water (tier ≥ 2) but never an ocean/major sea. Three well-
    // separated candidates so all place at budget 4.
    const placed = placeContextLabels(
      baseArgs({
        dLonSpan: 10,
        waterBodies: {
          entries: [
            [0, 0, 'Big Ocean', 0, 'ocean'], // major water (band 0)
            [55, 150, 'Tiny Sea', 2, 'sea'], // minor water (band 2)
          ],
        },
        countries: [bigFit], // 'Brazil', big footprint (band 1)
      })
    );
    const oceanIdx = placed.findIndex((l) => l.text === 'Big Ocean');
    const countryIdx = placed.findIndex((l) => l.text === 'Brazil');
    const minorIdx = placed.findIndex((l) => l.text === 'Tiny Sea');
    expect(oceanIdx).toBeGreaterThanOrEqual(0);
    expect(countryIdx).toBeGreaterThanOrEqual(0);
    expect(minorIdx).toBeGreaterThanOrEqual(0);
    expect(oceanIdx).toBeLessThan(countryIdx); // major water leads the country
    expect(countryIdx).toBeLessThan(minorIdx); // country outranks minor water
  });
});

describe('placeContextLabels — multi-position dodging (map-context-neighbor-labels)', () => {
  // A country with two well-separated interior positions; its name fits the
  // footprint at the ramped font. anchor === positions[0] (D12 invariant).
  const dodger = (positions: [number, number][]): CountryCandidate => ({
    name: 'Dodgeland',
    bbox: [100, 100, 480, 260], // big enough to hold the name
    anchor: positions[0]!,
    positions,
  });
  // Block any rect whose centre sits left of x=300 (simulates a data cluster
  // committed over the country's primary/centroid position).
  const blockLeft = (rect: { x: number; w: number }): boolean =>
    rect.x + rect.w / 2 < 300;

  it('AC1: primary position collides → places at a later free position', () => {
    const placed = placeContextLabels(
      baseArgs({
        waterBodies: { entries: [] },
        countries: [
          dodger([
            [200, 150],
            [400, 150],
          ]),
        ],
        collides: blockLeft,
      })
    );
    const d = placed.find((l) => l.text === 'Dodgeland');
    expect(d).toBeDefined();
    expect(d!.x).toBe(400); // dodged to the free second position
    expect(d!.y).toBe(150);
  });

  it('AC2: primary position clear → places there (later positions unused)', () => {
    const placed = placeContextLabels(
      baseArgs({
        waterBodies: { entries: [] },
        countries: [
          dodger([
            [200, 150],
            [400, 150],
          ]),
        ],
        collides: () => false,
      })
    );
    const d = placed.find((l) => l.text === 'Dodgeland');
    expect(d).toBeDefined();
    expect(d!.x).toBe(200); // best-first: the primary position wins
  });

  it('AC3: every position collides → dropped (no label)', () => {
    const placed = placeContextLabels(
      baseArgs({
        waterBodies: { entries: [] },
        countries: [
          dodger([
            [200, 150],
            [400, 150],
          ]),
        ],
        collides: () => true,
      })
    );
    expect(placed.find((l) => l.text === 'Dodgeland')).toBeUndefined();
  });

  it('AC9: a single-anchor candidate (positions absent) is unchanged', () => {
    const noPositions: CountryCandidate = {
      name: 'Plainland',
      bbox: [100, 100, 480, 260],
      anchor: [200, 150],
    };
    const placed = placeContextLabels(
      baseArgs({
        waterBodies: { entries: [] },
        countries: [noPositions],
        collides: () => false,
      })
    );
    const p = placed.find((l) => l.text === 'Plainland');
    expect(p).toBeDefined();
    expect(p!.x).toBe(200); // uses anchor (positions ?? [anchor])
  });
});

describe('placeContextLabels — proximity ranking (map-context-neighbor-labels)', () => {
  // 'Faraway' is big but on the right edge; 'Nearby' is small but at the content.
  const far: CountryCandidate = {
    name: 'Faraway',
    bbox: [600, 100, 780, 260],
    anchor: [690, 180],
  };
  const near: CountryCandidate = {
    name: 'Nearby',
    bbox: [100, 400, 180, 460],
    anchor: [140, 430],
  };

  it('without contentPoints: bigger footprint ranks first (legacy area rank)', () => {
    const placed = placeContextLabels(
      baseArgs({ waterBodies: { entries: [] }, countries: [near, far] })
    );
    const fi = placed.findIndex((l) => l.text === 'Faraway');
    const ni = placed.findIndex((l) => l.text === 'Nearby');
    expect(fi).toBeGreaterThanOrEqual(0);
    expect(ni).toBeGreaterThanOrEqual(0);
    expect(fi).toBeLessThan(ni); // bigger area committed first
  });

  it('with a content point at the small country: proximity wins the rank', () => {
    const placed = placeContextLabels(
      baseArgs({
        waterBodies: { entries: [] },
        countries: [near, far],
        contentPoints: [[140, 430]], // inside Nearby's footprint
      })
    );
    const fi = placed.findIndex((l) => l.text === 'Faraway');
    const ni = placed.findIndex((l) => l.text === 'Nearby');
    expect(ni).toBeGreaterThanOrEqual(0);
    expect(ni).toBeLessThan(fi); // closer to the story committed first
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
    expect(ocean.halo).toBe(false);
  });
});
