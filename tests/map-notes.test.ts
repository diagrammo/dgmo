import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMap } from '../src/map/parser';
import { resolveMap } from '../src/map/resolver';
import { layoutMap } from '../src/map/layout';
import { mapExportDimensions } from '../src/map/dimensions';
import { loadMapData } from '../src/map/load-data';
import { getPalette } from '../src/palettes';
import { render } from '../src/render';
import {
  STRUCTURAL_KEYWORDS,
  TAG_SUPPORTING_TYPES,
} from '../src/completion-registry';
import { measureLegendText } from '../src/utils/legend-constants';
import {
  rectCircleOverlap,
  rectsOverlap,
  segmentRectOverlap,
  type LabelRect,
} from '../src/label-layout';

const palette = getPalette('nord').dark;
const FIXTURE = readFileSync(
  join(__dirname, '../gallery/fixtures/map-notes.dgmo'),
  'utf8'
);

describe('map notes — parse (#2215)', () => {
  it('reads a note and its markdown body under a poi', () => {
    const p = parseMap(
      'map\npoi Lagos label: Port\n  note Busiest port\n    **Big**\n    line two\npoi Accra'
    );
    expect(p.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(p.pois[0]!.note).toEqual({
      heading: 'Busiest port',
      body: '**Big**\nline two',
      lineNumber: 3,
    });
    expect(p.pois[1]!.note).toBeUndefined();
  });

  it('reads notes under a region line and an edge line', () => {
    const p = parseMap(
      'map\nFrance\n  note Hosts the talks\nParis -> Berlin\n  note Night train\n    Twice weekly'
    );
    expect(p.regions).toHaveLength(1);
    expect(p.regions[0]!.note?.heading).toBe('Hosts the talks');
    expect(p.edges[0]!.note).toMatchObject({
      heading: 'Night train',
      body: 'Twice weekly',
    });
  });

  it('peels a trailing colour off the note line', () => {
    const p = parseMap('map\npoi Lagos\n  note Busiest port red');
    expect(p.pois[0]!.note?.heading).toBe('Busiest port');
    expect(p.pois[0]!.note?.color).toBeDefined();
  });

  it('warns on a note with nothing to sit under, and on a second note', () => {
    const p = parseMap(
      'map\nnote Orphan\n  body\npoi Lagos\n  note One\n  note Two'
    );
    const codes = p.diagnostics.map((d) => d.code);
    expect(codes).toContain('W_MAP_NOTE_NO_ANCHOR');
    expect(codes).toContain('W_MAP_NOTE_DUPLICATE');
    expect(p.regions).toHaveLength(0);
    expect(p.pois[0]!.note?.heading).toBe('One');
  });

  it('no-notes sets the directive', () => {
    expect(parseMap('map\nno-notes\npoi Lagos').directives.noNotes).toBe(true);
  });
});

describe('map notes — layout (#2215)', () => {
  const pad = (r: LabelRect, d: number): LabelRect => ({
    x: r.x - d,
    y: r.y - d,
    w: r.w + 2 * d,
    h: r.h + 2 * d,
  });

  for (const base of [1200, 800, 420]) {
    it(`places the chokepoint notes clear of everything at ${base}px`, async () => {
      const data = await loadMapData();
      const parsed = parseMap(FIXTURE, palette);
      const resolved = resolveMap(parsed, data);
      expect(
        resolved.diagnostics.filter((d) => d.severity === 'error')
      ).toEqual([]);
      const dims = mapExportDimensions(resolved, data, base);
      const layout = layoutMap(resolved, data, dims, {
        palette,
        isDark: true,
        legendMode: 'export',
        preferContain: dims.preferContain,
      });
      expect(layout.notes).toHaveLength(8);
      const cards = layout.notes.flatMap((n) => (n.card ? [n.card] : []));
      // Every note is a card or a pin, never both, never neither.
      for (const n of layout.notes) expect(!!n.card !== !!n.pin).toBe(true);
      // From the app's width up there is room for every note on the map.
      if (base >= 800) expect(cards).toHaveLength(8);
      else expect(cards.length).toBeGreaterThan(0);
      const segs = layout.legs.length;
      expect(segs).toBe(0);
      cards.forEach((c, i) => {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x + c.w).toBeLessThanOrEqual(layout.width);
        expect(c.y + c.h).toBeLessThanOrEqual(layout.height);
        for (const p of layout.pois)
          expect(rectCircleOverlap(c, { cx: p.cx, cy: p.cy, r: p.r })).toBe(
            false
          );
        cards.forEach((o, j) => {
          if (j !== i) expect(rectsOverlap(c, o)).toBe(false);
        });
        for (const n of layout.notes) {
          if (!n.leader || n.card === c) continue;
          const l = n.leader;
          expect(segmentRectOverlap(l.x1, l.y1, l.x2, l.y2, c)).toBe(false);
        }
        // Labels fit around the cards.
        for (const l of layout.labels) {
          if (l.hidden || l.lines) continue;
          const f = l.fontSize ?? 11;
          const lw = measureLegendText(l.text, f);
          const lx =
            l.anchor === 'start'
              ? l.x
              : l.anchor === 'end'
                ? l.x - lw
                : l.x - lw / 2;
          expect(
            rectsOverlap(pad(c, -2), { x: lx, y: l.y - f * 0.75, w: lw, h: f })
          ).toBe(false);
        }
      });
      // A noted POI draws no label of its own.
      const noted = new Set(layout.notes.map((n) => n.id));
      expect(
        layout.labels.filter((l) => l.poiId && noted.has(l.poiId))
      ).toEqual([]);
    });
  }

  it('no-notes draws none', async () => {
    const data = await loadMapData();
    const resolved = resolveMap(
      parseMap(`${FIXTURE}\nno-notes`, palette),
      data
    );
    const layout = layoutMap(
      resolved,
      data,
      { width: 900, height: 500 },
      { palette, isDark: true }
    );
    expect(layout.notes).toEqual([]);
  });

  it('a region and an edge take a note', async () => {
    const data = await loadMapData();
    const src =
      'map\nFrance\n  note Hosts the talks\npoi Paris\npoi Berlin\nParis -night train-> Berlin\n  note Twice weekly';
    const resolved = resolveMap(parseMap(src, palette), data);
    const layout = layoutMap(
      resolved,
      data,
      { width: 900, height: 600 },
      { palette, isDark: true }
    );
    const kinds = layout.notes.map((n) => n.kind).sort();
    expect(kinds).toEqual(['edge', 'region']);
    const edge = layout.notes.find((n) => n.kind === 'edge')!;
    expect(edge.name).toBe('night train');
    // The noted edge's own label goes; the card names it.
    expect(layout.legs[0]!.label).toBeUndefined();
    // The noted region's label goes too.
    expect(layout.labels.some((l) => l.text === 'France')).toBe(false);
  });
});

describe('map notes — render (#2215)', () => {
  it('draws cards in the SVG and grows it for a key at 420px', async () => {
    const { svg: wide } = await render(FIXTURE, {
      mapData: loadMapData,
      theme: 'dark',
    });
    expect(wide.match(/class="dgmo-map-note"/g)).toHaveLength(8);
    expect(wide).not.toContain('dgmo-note-key');
    const { svg: narrow } = await render(FIXTURE, {
      mapData: loadMapData,
      theme: 'dark',
      width: 420,
    });
    // The stepped-down notes' key sits under the map, in a taller drawing.
    expect(narrow).toContain('class="dgmo-note-key"');
    const rows = narrow.match(/class="dgmo-note-key-row"/g) ?? [];
    const cards = narrow.match(/class="dgmo-map-note"/g) ?? [];
    expect(rows.length + cards.length).toBe(8);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('map note completion', () => {
  it('offers poi, route, note and tag as map keywords', () => {
    expect(STRUCTURAL_KEYWORDS.get('map')).toEqual([
      'poi',
      'route',
      'note',
      'tag',
    ]);
    expect(TAG_SUPPORTING_TYPES.has('map')).toBe(true);
  });
});
