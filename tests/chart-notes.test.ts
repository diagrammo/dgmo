// The annotation vocabulary on data charts (#2039): `marker` on either axis,
// `era` on bar, `note` on bar, line, scatter and slope, and the end-of-line
// series names on line (#1950). A `note` and a category `marker` sit
// indented under the row they belong to (#2078).
import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { parseExtendedChart } from '../src/data-chart-parser';
import { parseVisualization } from '../src/visualizations/parse';
import { renderDataChartD3 } from '../src/charts-d3';
import { renderForExport } from '../src/d3';
import { getPalette } from '../src/palettes';
import { labelBox } from '../src/utils/place-labels';
import { flattenTabular } from './helpers/tabular-text';
import { noteBlock, NOTE_FONT } from '../src/annotations/notes';
import { segmentRectOverlap, segmentsCross } from '../src/label-layout';
import { measureText } from '../src/utils/text-measure';

const palette = getPalette('nord').light;
const messages = (d: { diagnostics: { message: string }[] }) =>
  d.diagnostics.map((x) => x.message);

/** The [x1, x2, y1, y2] of every marker line. */
function markerLines(svg: string): number[][] {
  return [
    ...svg.matchAll(
      /class="dgmo-annotation-marker"[^>]*><line x1="([\d.]+)" x2="([\d.]+)" y1="([\d.]+)" y2="([\d.]+)"/g
    ),
  ].map((m) => m.slice(1).map(Number));
}

const noteCount = (svg: string) =>
  (svg.match(/class="dgmo-chart-note[" ]/g) ?? []).length;

describe('marker', () => {
  it('indented under a row, it is a category-axis line on bar and line', async () => {
    const c = parseChart('bar S\nQ1 4\nQ2 5\nQ3 6\n  marker Price change');
    expect(c.annotations).toEqual([
      expect.objectContaining({
        axis: 'cross',
        at: 'Q3',
        label: 'Price change',
      }),
    ]);
    for (const type of ['bar', 'line']) {
      const svg = await renderDataChartD3(
        `${type} S\nQ1 4\nQ2 5\n  marker Launch\nQ3 6`,
        'light',
        palette
      );
      const [[x1, x2, y1, y2]] = markerLines(svg) as [number[]];
      expect(x1).toBe(x2);
      expect(y2).toBeGreaterThan(y1!);
      expect(svg).toContain('>Launch</text>');
    }
  });

  it('under a numeric category it needs no axis word; a top-level number is the value axis', () => {
    const src = 'line S\n2020 4\n2021 5\n  marker Launch red\n2022 6';
    const c = parseChart(src);
    expect(c.annotations?.[0]).toMatchObject({
      axis: 'cross',
      at: '2021',
      label: 'Launch',
    });
    expect(c.annotations?.[0]?.color).toBeTruthy();
    const y = parseChart(`${src}\nmarker 5 Target`);
    expect(y.annotations?.[0]).toMatchObject({ axis: 'value', at: 5 });
  });

  it('the old top-level category form warns with the indented one', () => {
    const c = parseChart(
      'bar S\nmarker Port Royal Raid\nNassau 4\nPort Royal 5'
    );
    expect(c.annotations).toBeUndefined();
    expect(messages(c)).toEqual([
      expect.stringContaining('Port Royal\n  marker Raid'),
    ]);
  });

  it('ref-line is gone', () => {
    const c = parseChart('bar S\nref-line 50\nA 4');
    expect(c.annotations).toBeUndefined();
  });

  it('scatter: marker is y, marker x is x, band x shades an x range', async () => {
    const src =
      'scatter S\nmarker 5 Target\nmarker x 3 Launch\nband x 1..2 Early\nA 1 2\nB 4 8';
    const p = parseExtendedChart(src);
    expect(p.diagnostics).toEqual([]);
    const svg = await renderDataChartD3(src, 'light', palette);
    const lines = markerLines(svg);
    expect(lines).toHaveLength(2);
    expect(lines.filter(([x1, x2]) => x1 === x2)).toHaveLength(1);
    expect(svg).toContain('dgmo-annotation-band');
    expect(svg).toContain('>Early</text>');
  });

  it('band x warns on a chart whose x axis is categories', () => {
    expect(messages(parseChart('bar S\nband x 1..2\nA 4')).join()).toContain(
      'band x needs a numeric x axis'
    );
  });

  it('slope: marker and band draw on the value range', async () => {
    const src =
      'slope S\nperiod 2020 2024\nmarker y 50 Target\nband 10..20 Low\nA 40 60\nB 30 15';
    expect(parseVisualization(src).diagnostics).toEqual([]);
    const svg = await renderForExport(src, 'light', palette);
    expect(svg).toContain('dgmo-annotation-marker');
    expect(svg).toContain('dgmo-annotation-band');
  });
});

describe('era on bar', () => {
  it('draws a span over the named categories', async () => {
    const svg = await renderDataChartD3(
      'bar S\nera Tortuga -> Nassau Golden age\nPort Royal 3\nTortuga 4\nNassau 5',
      'light',
      palette
    );
    expect(svg).toContain('class="dgmo-era"');
    expect(svg).toContain('>Golden age</text>');
  });

  it('warns on a chart with no ordered axis', () => {
    expect(messages(parseChart('pie P\nera A -> B Span\nA 1\nB 2'))).toEqual([
      expect.stringContaining('"era" is only supported on line and bar'),
    ]);
  });
});

describe('note', () => {
  it('marks the row it sits under; several series name theirs first', () => {
    const bar = parseChart('bar S\nQ1 4\nQ2 5\n  note Frankfurt opens');
    expect(bar.notes).toEqual([
      expect.objectContaining({ series: 0, index: 1, text: 'Frankfurt opens' }),
    ]);
    const line = parseChart(
      'line S\nseries EMEA, APAC\nQ1 4 5\nQ2 5 6\n  note APAC Frankfurt opens'
    );
    expect(line.notes?.[0]).toMatchObject({
      series: 1,
      index: 1,
      text: 'Frankfurt opens',
    });
  });

  it('takes an indented body', () => {
    const c = parseChart(
      'bar S\nNassau 4\nPort Royal 5\n  note Sacked\n    by **Morgan**'
    );
    expect(c.notes?.[0]).toMatchObject({
      index: 1,
      text: 'Sacked\nby **Morgan**',
    });
    expect(c.data).toHaveLength(2);
    expect(c.diagnostics).toEqual([]);
  });

  it('keeps its row through sort', () => {
    const c = parseChart('bar S\nsort desc\nA 1\n  note Small\nB 9');
    expect(c.data.map((d) => d.label)).toEqual(['B', 'A']);
    expect(c.notes?.[0]).toMatchObject({ index: 1, text: 'Small' });
  });

  it('warns on no row, no series, no text, and the old top-level form', () => {
    const c = parseChart(
      [
        'line S',
        'series',
        '  EMEA',
        '    note Not a row',
        '  APAC',
        'Q1 4 5',
        '  note Which one',
        '  note APAC',
        'note Q1 Old form',
      ].join('\n')
    );
    expect(c.notes).toBeUndefined();
    expect(messages(c)).toEqual([
      expect.stringContaining('Q1\n  note Old form'),
      expect.stringContaining('goes indented under a data row'),
      expect.stringContaining('note EMEA Which one'),
      expect.stringContaining('has no text'),
    ]);
  });

  it('stands above a column with no ring; past a horizontal bar to the right', async () => {
    for (const orient of ['', 'orientation-horizontal\n']) {
      const svg = await renderDataChartD3(
        `bar S\n${orient}Q1 ${orient ? 9 : 4}\nQ2 ${orient ? 4 : 9}\n  note Record haul\nQ3 3`,
        'light',
        palette
      );
      expect(noteCount(svg)).toBe(1);
      expect(svg).not.toContain('dgmo-chart-note-ring');
      const bar = svg.match(
        /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*data-name="Q2"/
      )!;
      const [bx, by, bw, bh] = bar.slice(1).map(Number) as [
        number,
        number,
        number,
        number,
      ];
      const t = svg.match(
        /class="dgmo-chart-note"[\s\S]*?<text x="([\d.]+)" y="([\d.]+)"/
      )!;
      const [tx, ty] = [Number(t[1]), Number(t[2])];
      if (orient) expect(tx).toBeGreaterThan(bx + bw);
      else {
        // The text's baseline sits above the bar's top, over its span.
        expect(ty).toBeLessThan(by);
        expect(tx).toBeLessThan(bx + bw);
      }
      void bh;
    }
  });

  it('draws a ring, a leader and the text on line, scatter and slope', async () => {
    const cases = [
      'line S\nQ1 4\nQ2 5\n  note Frankfurt opens\nQ3 3',
      'scatter S\nA 1 2\nB 4 8\n  note Frankfurt opens\nC 6 3',
    ];
    for (const src of cases) {
      const svg = await renderDataChartD3(src, 'light', palette);
      expect(noteCount(svg)).toBe(1);
      expect(svg).toContain('dgmo-chart-note-ring');
      expect(svg).toContain('Frankfurt opens');
    }
    const slope = await renderForExport(
      'slope S\nperiod 2020 2024\nRust 20 60\n  note 2024 Overtakes Go\nGo 40 50',
      'light',
      palette
    );
    expect(noteCount(slope)).toBe(1);
  });

  it('a crowded column chart keeps every note over its bar, leaders clear (#2136)', async () => {
    const ports: [string, number, string][] = [
      ['Port Royal', 850, 'Sacked twice'],
      ['Tortuga', 620, 'Pirate republic'],
      ['Nassau', 1100, 'Governor pardoned the fleet'],
      ['Havana', 400, 'Treasure fleet departs'],
      ['Cartagena', 520, 'Fortress held'],
      ['Santo Domingo', 330, 'Oldest town'],
      ['Kingston', 480, 'Earthquake'],
      ['Bridgetown', 710, 'Rum shipments'],
      ['Curacao', 290, 'Free port'],
      ['Veracruz', 940, 'Silver arrives'],
      ['Campeche', 150, 'Ship yards'],
      ['Maracaibo', 260, 'Raided by Morgan'],
      ['Portobelo', 600, 'Fair held yearly'],
      ['Charleston', 380, 'Blockaded'],
    ];
    const src =
      'bar Every port gets a note\n' +
      ports.map(([p, v, n]) => `${p} ${v}\n  note ${n}`).join('\n');
    // The app preview pane sizes and the wider default export. Below about 560px
    // a bar gets less room than one word of its note, and notes overlap.
    for (const dims of [
      undefined,
      { width: 700, height: 560 },
      { width: 560, height: 420 },
      { width: 640, height: 480 },
    ]) {
      const svg = await renderDataChartD3(src, 'light', palette, dims);
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const num = (e: Element, a: string) => Number(e.getAttribute(a));
      const bars = [...doc.querySelectorAll('rect[data-name]')].map((e) => ({
        x: num(e, 'x'),
        y: num(e, 'y'),
        w: num(e, 'width'),
        h: num(e, 'height'),
      }));
      expect(bars).toHaveLength(ports.length);
      const notes = [...doc.querySelectorAll('g.dgmo-chart-note')].map((g) => {
        const texts = [...g.querySelectorAll('text')];
        const xs = texts.map((t) => num(t, 'x'));
        const ys = texts.map((t) => num(t, 'y'));
        const w = Math.max(
          ...texts.map((t) => measureText(t.textContent ?? '', NOTE_FONT))
        );
        const box = {
          x: Math.min(...xs),
          y: Math.min(...ys) - NOTE_FONT * 0.95,
          w,
          h: Math.max(...ys) - Math.min(...ys) + NOTE_FONT * 1.3,
        };
        const l = g.querySelector('line.dgmo-chart-note-leader');
        const leader = l
          ? ([num(l, 'x1'), num(l, 'y1'), num(l, 'x2'), num(l, 'y2')] as const)
          : null;
        return { box, leader };
      });
      expect(notes).toHaveLength(ports.length);
      const overlap = (
        a: { x: number; y: number; w: number; h: number },
        b: { x: number; y: number; w: number; h: number }
      ) =>
        a.x < b.x + b.w &&
        b.x < a.x + a.w &&
        a.y < b.y + b.h &&
        b.y < a.y + a.h;
      const step = bars[1]!.x - bars[0]!.x;
      notes.forEach(({ box, leader }, i) => {
        // Text over its own column: it spans the bar's centre or stands
        // within a step of it.
        const cx = bars[i]!.x + bars[i]!.w / 2;
        const gap = Math.max(0, box.x - cx, cx - (box.x + box.w));
        expect(gap, ports[i]![2]).toBeLessThanOrEqual(step);
        for (const b of bars)
          expect(
            overlap(box, b),
            `${ports[i]![2]} ${JSON.stringify(dims)} ${JSON.stringify(box)} ${JSON.stringify(b)}`
          ).toBe(false);
        notes.forEach((o, j) => {
          if (j !== i) expect(overlap(box, o.box), ports[i]![2]).toBe(false);
        });
        if (!leader) return;
        const [x0, y0, x1, y1] = leader;
        const len = Math.hypot(x1 - x0, y1 - y0);
        const [ax, ay] = [
          x0 + ((x1 - x0) * 3) / len,
          y0 + ((y1 - y0) * 3) / len,
        ];
        for (const b of bars)
          expect(segmentRectOverlap(ax, ay, x1, y1, b), ports[i]![2]).toBe(
            false
          );
        notes.forEach((o, j) => {
          if (j === i) return;
          if (o.leader)
            expect(
              segmentsCross(x0, y0, x1, y1, ...o.leader),
              ports[i]![2]
            ).toBe(false);
          expect(segmentRectOverlap(x0, y0, x1, y1, o.box), ports[i]![2]).toBe(
            false
          );
        });
      });
    }
  });

  it('too narrow for captions, every note is numbered with a key under the chart (#2159)', async () => {
    const ports: [string, number, string][] = [
      ['Port Royal', 850, 'Sacked twice'],
      ['Tortuga', 620, 'Pirate republic'],
      ['Nassau', 1100, 'Governor pardoned the fleet'],
      ['Havana', 400, 'Treasure fleet departs'],
      ['Cartagena', 520, 'Fortress held'],
      ['Santo Domingo', 330, 'Oldest town'],
      ['Kingston', 480, 'Earthquake'],
      ['Bridgetown', 710, 'Rum shipments'],
      ['Curacao', 290, 'Free port'],
      ['Veracruz', 940, 'Silver arrives'],
      ['Campeche', 150, 'Ship yards'],
      ['Maracaibo', 260, 'Raided by Morgan'],
      ['Portobelo', 600, 'Fair held yearly'],
      ['Charleston', 380, 'Blockaded'],
    ];
    const src =
      'bar Every port gets a note\n' +
      ports.map(([p, v, n]) => `${p} ${v}\n  note ${n}`).join('\n');
    const wide = await renderDataChartD3(src, 'light', palette, {
      width: 700,
      height: 560,
    });
    expect(wide).not.toContain('dgmo-note-key');
    for (const dims of [
      { width: 480, height: 360 },
      { width: 400, height: 320 },
    ]) {
      const svg = await renderDataChartD3(src, 'light', palette, dims);
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const num = (e: Element, a: string) => Number(e.getAttribute(a));
      const marks = [...doc.querySelectorAll('g.dgmo-note-mark')];
      const rows = [...doc.querySelectorAll('g.dgmo-note-key-row')];
      expect(marks).toHaveLength(ports.length);
      expect(rows).toHaveLength(ports.length);
      // No caption text is drawn on the plot: the text lives in the key.
      expect(doc.querySelectorAll('.dgmo-chart-note-leader')).toHaveLength(0);
      const bars = [...doc.querySelectorAll('rect[data-name]')];
      bars.forEach((bar, i) => {
        // Bar i carries number i + 1; its disc stands over it.
        expect(bar.getAttribute('data-note-key')).toBe(String(i + 1));
        const mark = doc.querySelector(
          `g.dgmo-note-mark[data-note-key="${i + 1}"] circle`
        )!;
        const cx = num(mark, 'cx');
        expect(Math.abs(cx - (num(bar, 'x') + num(bar, 'width') / 2))).toBe(0);
        expect(num(mark, 'cy') + num(mark, 'r')).toBeLessThanOrEqual(
          num(bar, 'y')
        );
        const row = doc.querySelector(
          `g.dgmo-note-key-row[data-note-key="${i + 1}"]`
        )!;
        const text = [...row.querySelectorAll('.dgmo-note-key-text')]
          .map((t) => t.textContent)
          .join(' ');
        expect(text).toBe(ports[i]![2]);
      });
      // The key sits below the chart as asked for, which grows by the key.
      const rowTops = rows.map(
        (r) => num(r.querySelector('circle')!, 'cy') - 7
      );
      const rowBottoms = rows.map(
        (r) => num(r.querySelector('circle')!, 'cy') + 7
      );
      expect(Math.min(...rowTops)).toBeGreaterThanOrEqual(dims.height);
      const root = doc.documentElement;
      expect(num(root, 'height')).toBeGreaterThan(dims.height);
      expect(Math.max(...rowBottoms)).toBeLessThanOrEqual(num(root, 'height'));
      expect(root.getAttribute('viewBox')).toBe(
        `0 0 ${dims.width} ${num(root, 'height')}`
      );
      // Hovering any of the three lights the others.
      expect(svg).toContain('svg:has([data-note-key="3"]:hover)');
    }
  });

  it('every note is drawn, even when the plot is crowded', async () => {
    const rows = ['Q1', 'Q2', 'Q3', 'Q4']
      .map(
        (q, i) =>
          `${q} ${i + 4}\n  note A long note about what happened in ${q}`
      )
      .join('\n');
    const svg = await renderDataChartD3(`bar S\n${rows}`, 'light', palette, {
      width: 360,
      height: 240,
    });
    expect(noteCount(svg)).toBe(4);
  });

  it('no-notes hides them', async () => {
    const svg = await renderDataChartD3(
      'line S\nno-notes\nQ1 4\nQ2 5\n  note Hidden',
      'light',
      palette
    );
    expect(noteCount(svg)).toBe(0);
  });

  it('stays full strength under highlight', async () => {
    const svg = await renderDataChartD3(
      'bar S\nQ1 4\n  highlight\nQ2 5\n  note Still here',
      'light',
      palette
    );
    expect(svg).toMatch(/class="dgmo-chart-note" data-line-number="5">/);
  });

  it('a point value under a note yields to it', async () => {
    const svg = await renderDataChartD3(
      'line S\nQ1 4\nQ2 5\n  note Frankfurt opens\nQ3 4.5',
      'light',
      palette
    );
    const note = svg.match(
      /class="dgmo-chart-note"[\s\S]*?<text x="([\d.]+)" y="([\d.]+)"/
    )!;
    const box = labelBox(
      'Frankfurt opens',
      { x: Number(note[1]), y: Number(note[2]), anchor: 'start' },
      11
    );
    for (const m of svg.matchAll(
      /<text x="([\d.]+)" y="([\d.]+)" text-anchor="(\w+)"[^>]*font-size="12"[^>]*>([\d.]+)<\/text>/g
    )) {
      const v = labelBox(
        m[4]!,
        { x: Number(m[1]), y: Number(m[2]), anchor: m[3] as 'middle' },
        12
      );
      const overlap =
        v.x < box.x + box.w &&
        box.x < v.x + v.w &&
        v.y < box.y + box.h &&
        box.y < v.y + v.h;
      expect(overlap).toBe(false);
    }
  });

  /** The text box of the note drawn from source line `line`. */
  function noteBox(svg: string, line: number, text: string) {
    const g = svg.match(
      new RegExp(
        `class="dgmo-chart-note" data-line-number="${line}"[\\s\\S]*?<text x="([\\d.]+)" y="([\\d.]+)"`
      )
    )!;
    const { w, h } = noteBlock(text);
    return { x: Number(g[1]), y: Number(g[2]) - NOTE_FONT * 0.95, w, h };
  }

  it('its text never crosses a marker line; the leader may (#2134)', async () => {
    // Cartagena sits just right of the x=77 marker; the first clear spot
    // used to straddle the line, since only its label was an obstacle.
    const src = [
      'scatter Voyage',
      'marker x 77 Meridian crossing',
      'Port Royal 76.8 17.9',
      'Tortuga 72.8 20.0',
      'Nassau 77.3 25.0',
      'Havana 82.4 23.1',
      'Cartagena 75.5 10.4',
      '  note Southern limit',
      '    Provisions *ran out* here',
    ].join('\n');
    const svg = await renderDataChartD3(src, 'light', palette);
    const [[mx]] = markerLines(svg) as [number[]];
    const box = noteBox(svg, 8, 'Southern limit\nProvisions *ran out* here');
    expect(box.x > mx! || box.x + box.w < mx!).toBe(true);
  });

  it('takes open space over a gap between lines (#2134)', async () => {
    // Vane's 1720 point sits under three converging lines; the first clear
    // spot, above-left, was a 3px slot between them.
    const src = [
      'line Plunder',
      'no-extremes',
      'series',
      '  Blackbeard',
      '  Bonnet',
      '  Vane',
      '1716 12 8 10',
      '1717 28 16 22',
      '1718 46 24 31',
      '1719 30 19 36',
      '1720 22 11 18',
      '  note Vane Hanged at Port Royal',
    ].join('\n');
    const svg = await renderDataChartD3(src, 'light', palette);
    const box = noteBox(svg, 12, 'Hanged at Port Royal');
    const segs = [...svg.matchAll(/class="dgmo-series-line" d="M([^"]+)"/g)]
      .map((m) => m[1]!.split('L').map((p) => p.split(',').map(Number)))
      .flatMap((pts) => pts.slice(1).map((p, i) => [pts[i]!, p] as const));
    // Nearest any series line comes to the note's box, sampled along each.
    let near = Infinity;
    for (const [[x0, y0], [x1, y1]] of segs)
      for (let k = 0; k <= 50; k++) {
        const x = x0! + ((x1! - x0!) * k) / 50;
        const y = y0! + ((y1! - y0!) * k) / 50;
        const dx = Math.max(box.x - x, 0, x - box.x - box.w);
        const dy = Math.max(box.y - y, 0, y - box.y - box.h);
        near = Math.min(near, Math.hypot(dx, dy));
      }
    expect(near).toBeGreaterThan(12);
  });

  it("a line note's leader crosses no line and no other leader (#2158)", async () => {
    // Three lines braid, and a note sits on most years. A point boxed in
    // between two lines has no leader that crosses nothing, so none is here.
    const src = [
      'line Plunder',
      'series',
      '  Blackbeard',
      '  Bonnet',
      '  Vane',
      '1716 12 8 10',
      '  note Bonnet First prize',
      '1717 28 16 22',
      '  note Blackbeard Takes Revenge',
      '1718 46 24 31',
      '1719 30 19 36',
      '  note Bonnet Hanged',
      '1720 22 11 18',
      '  note Vane Hanged at Port Royal',
    ].join('\n');
    for (const dims of [undefined, { width: 480, height: 320 }]) {
      const svg = await renderDataChartD3(src, 'light', palette, dims);
      const segs = [...svg.matchAll(/class="dgmo-series-line" d="M([^"]+)"/g)]
        .map((m) => m[1]!.split('L').map((p) => p.split(',').map(Number)))
        .flatMap((pts) => pts.slice(1).map((p, i) => [pts[i]!, p] as const));
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const num = (e: Element, a: string) => Number(e.getAttribute(a));
      const leaders = [
        ...doc.querySelectorAll('line.dgmo-chart-note-leader'),
      ].map(
        (l) => [num(l, 'x1'), num(l, 'y1'), num(l, 'x2'), num(l, 'y2')] as const
      );
      expect(leaders.length).toBeGreaterThan(0);
      leaders.forEach(([x0, y0, x1, y1], i) => {
        // Trim the start: the datum's own line runs through the ring.
        const len = Math.hypot(x1 - x0, y1 - y0);
        const ax = x0 + ((x1 - x0) * 4) / len;
        const ay = y0 + ((y1 - y0) * 4) / len;
        for (const [[sx0, sy0], [sx1, sy1]] of segs)
          expect(
            segmentsCross(ax, ay, x1, y1, sx0!, sy0!, sx1!, sy1!),
            `${JSON.stringify(dims)} leader ${i}`
          ).toBe(false);
        leaders.forEach((o, j) => {
          if (j !== i) expect(segmentsCross(x0, y0, x1, y1, ...o)).toBe(false);
        });
      });
    }
  });

  it('warns on a chart type that does not take notes', () => {
    expect(messages(parseChart('pie P\nA 1\n  note Big\nB 2'))).toEqual([
      expect.stringContaining('"note" is only supported on bar, line'),
    ]);
  });
});

describe('end-of-line series names on line (#1950)', () => {
  const src = [
    'line Fleet',
    'series',
    '  Cutlass Crew',
    '  Powder Monkeys',
    '  Rigging Rats',
    'Nassau 4.2 1.1 0.6',
    'Tortuga 6.5 1.9 0.9',
    'Kingston 11.4 5.1 3.0',
  ].join('\n');

  it('draws each name at the right end of its line, clear of the others', async () => {
    const svg = await renderDataChartD3(src, 'light', palette);
    const names = [
      ...svg.matchAll(
        /class="dgmo-series-end-label" data-series-name="([^"]+)" x="([\d.]+)" y="([\d.]+)"/g
      ),
    ].map((m) => ({ name: m[1]!, x: Number(m[2]), y: Number(m[3]) }));
    expect(names.map((n) => n.name)).toEqual([
      'Cutlass Crew',
      'Powder Monkeys',
      'Rigging Rats',
    ]);
    const ys = names.map((n) => n.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++)
      expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(12);
    // Point values stay on by default.
    expect(flattenTabular(svg)).toContain('>11.4</text>');
  });

  it('a single line keeps its plain look', async () => {
    const svg = await renderDataChartD3('line S\nA 1\nB 2', 'light', palette);
    expect(svg).not.toContain('dgmo-series-end-label');
  });
});
