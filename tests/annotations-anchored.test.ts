// A per-datum annotation sits indented under its row (#2078, #2080): proximity
// names the datum, so a `note` or `highlight` never repeats it.
import { describe, it, expect } from 'vitest';
import { liftAnchored } from '../src/annotations/anchored';
import { parseExtendedChart } from '../src/data-chart-parser';
import { parseSlope } from '../src/slope/parser';
import { render } from '../src/render';
import { renderDataChartD3 } from '../src/charts-d3';
import { getPalette } from '../src/palettes';

const messages = (d: { diagnostics: { message: string }[] }) =>
  d.diagnostics.map((x) => x.message);

describe('liftAnchored', () => {
  it('blanks each lifted line and its body, so line numbers never move', () => {
    const src = ['bar B', 'Nassau 5', '  note A', '    b', 'Havana 3'];
    const { lines, anchored } = liftAnchored(src);
    expect(lines).toEqual(['bar B', 'Nassau 5', '', '', 'Havana 3']);
    expect(anchored).toEqual([
      expect.objectContaining({
        keyword: 'note',
        anchorLine: 2,
        text: 'A',
        body: 'b',
        lineNumber: 3,
      }),
    ]);
  });

  it('a capitalised Note row stays data', () => {
    const { anchored } = liftAnchored(['bar B', 'Group', '  Note 5']);
    expect(anchored).toEqual([]);
  });
});

describe('scatter', () => {
  const SRC = [
    'scatter S',
    '[Royal] blue',
    '  Victory 7 820',
    '    note Flagship',
    '[Pirate] red',
    '  highlight',
    '  Black Pearl 12 40',
  ].join('\n');

  it('a note under a point, a highlight under a [Group]', () => {
    const p = parseExtendedChart(SRC);
    expect(p.diagnostics).toEqual([]);
    expect(p.notes).toEqual([
      expect.objectContaining({ index: 0, text: 'Flagship' }),
    ]);
    expect(p.emphasis?.names).toEqual(['Pirate']);
    expect(p.scatterPoints).toHaveLength(2);
  });

  it('the old chart-level forms warn and draw nothing', () => {
    const p = parseExtendedChart(
      'scatter S\nhighlight A\nnote A Old\nA 1 2\nB 3 4'
    );
    expect(p.emphasis).toBeUndefined();
    expect(p.notes).toBeUndefined();
    expect(messages(p)).toEqual([
      expect.stringContaining('A\n  highlight'),
      expect.stringContaining('A\n  note Old'),
    ]);
  });
});

describe('slope', () => {
  it('a note under a series row starts with its period', () => {
    const p = parseSlope(
      'slope S\nperiod 2020 2025\nRust 18 5\n  note 2025 Overtakes Go\n  highlight orange\nGo 10 7\n  note Which year'
    );
    expect(p.notes).toEqual([
      expect.objectContaining({ series: 0, index: 1, text: 'Overtakes Go' }),
    ]);
    expect(p.emphasis?.names).toEqual(['Rust orange']);
    expect(messages(p)).toEqual([
      expect.stringContaining('note 2025 Which year'),
    ]);
  });
});

describe('per-export highlight on a data chart', () => {
  it('replaces the indented highlight', async () => {
    const src = 'bar B\nNassau 5\n  highlight\nHavana 3';
    const fill = async (h?: string) => {
      const { svg, diagnostics } = await render(
        src,
        h ? { highlight: h, theme: 'light' } : { theme: 'light' }
      );
      expect(diagnostics).toEqual([]);
      const m = (name: string) =>
        svg.match(new RegExp(`fill="([^"]+)"[^>]*data-name="${name}"`))![1];
      return { nassau: m('Nassau'), havana: m('Havana') };
    };
    const own = await fill();
    const over = await fill('Havana');
    expect(over.havana).toBe(own.nassau);
    expect(over.nassau).toBe(own.havana);
  });
});

describe('band label (#2078)', () => {
  it('is drawn over the bars, clear of them where the band has room', async () => {
    const svg = await renderDataChartD3(
      'bar S\nband 400..600 Usual haul green\nA 850\nB 300\nC 900',
      'light',
      getPalette('nord').light
    );
    const label = svg.indexOf('dgmo-annotation-band-label');
    const lastBar = svg.lastIndexOf('data-name="C"');
    expect(label).toBeGreaterThan(lastBar);
    expect(svg).toMatch(/dgmo-annotation-band-label[^>]*stroke="#/);
  });
});
