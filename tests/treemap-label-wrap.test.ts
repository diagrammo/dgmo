import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderForExport } from '../src/d3';
import { getPalette } from '../src/palettes';
import { measureText } from '../src/utils/text-measure';
import { FULL_TEXT_ATTR } from '../src/utils/full-text';
import { TREEMAP_LABEL_MIN_FS } from '../src/treemap/renderer';

// Long leaf names wrap to fill their cell before any "…" cut (#2466). The
// fixture mirrors the owner's pressure file: 15 leaves, each ~150 characters.

const palette = getPalette('nord').light;

const WORDS =
  'quarterly revenue forecast adjustment for the northern distribution region including warehousing logistics overhead and seasonal staffing costs across all sites';

const longName = (i: number): string =>
  `Item ${i} ${WORDS}`.slice(0, 150).trim();

const VALUES = [
  400, 220, 180, 150, 120, 100, 90, 80, 70, 60, 50, 40, 30, 25, 20,
];

const SOURCE = `treemap Long labels
${VALUES.map((v, i) => `${longName(i + 1)} ${v}`).join('\n')}
`;

let doc: Document;
beforeAll(async () => {
  const svg = await renderForExport(SOURCE, 'light', palette);
  doc = new new JSDOM('').window.DOMParser().parseFromString(
    svg,
    'image/svg+xml'
  );
});

/** Drawn lines of a label: its tspans, or the text itself when one line. */
function lineEls(label: Element): Element[] {
  const spans = [...label.querySelectorAll('tspan')];
  return spans.length ? spans : [label];
}

interface Leaf {
  w: number;
  h: number;
  label: Element;
  cell: Element;
}

function leaves(): Leaf[] {
  return [...doc.querySelectorAll('.dgmo-treemap-label')].map((label) => {
    const cell = label.parentElement!;
    const rect = cell.querySelector('rect')!;
    return {
      w: Number(rect.getAttribute('width')),
      h: Number(rect.getAttribute('height')),
      label,
      cell,
    };
  });
}

describe('treemap — long leaf labels wrap to fill the cell (#2466)', () => {
  it('draws every leaf label', () => {
    expect(leaves()).toHaveLength(VALUES.length);
  });

  it('the largest cell shows at least two wrapped lines at a readable size', () => {
    const biggest = leaves().sort((a, b) => b.w * b.h - a.w * a.h)[0]!;
    const lines = lineEls(biggest.label);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const fs = Number(biggest.label.getAttribute('font-size'));
    expect(fs).toBeGreaterThanOrEqual(TREEMAP_LABEL_MIN_FS);
    // Most of the 150-character name is shown.
    const shown = [...lines].map((l) => l.textContent ?? '').join(' ');
    expect(shown.replace(/…/g, '').length).toBeGreaterThan(75);
  });

  it('no label box leaves its cell', () => {
    for (const { w, h, label } of leaves()) {
      const fs = Number(label.getAttribute('font-size'));
      const rotated = (label.getAttribute('transform') ?? '').includes(
        'rotate'
      );
      // Rotated labels run along the height and stack across the width.
      const [len, depth] = rotated ? [h, w] : [w, h];
      for (const t of lineEls(label)) {
        const lineW = measureText(t.textContent ?? '', fs, { bold: true });
        const y = Number(t.getAttribute('y') ?? 0);
        if (rotated) {
          expect(lineW).toBeLessThanOrEqual(len);
          // y is across the width, centred on the cell.
          expect(depth / 2 + y - fs * 0.78).toBeGreaterThanOrEqual(0);
          expect(depth / 2 + y + fs * 0.26).toBeLessThanOrEqual(depth);
        } else {
          const x = Number(t.getAttribute('x'));
          expect(x + lineW).toBeLessThanOrEqual(len);
          expect(y - fs * 0.78).toBeGreaterThanOrEqual(0);
          expect(y + fs * 0.26).toBeLessThanOrEqual(depth);
        }
      }
    }
  });

  it('a cut label keeps its full name in data-full-text, never a <title>', () => {
    const cut = leaves().filter((l) => l.label.textContent!.includes('…'));
    for (const { cell } of cut) {
      expect(cell.getAttribute(FULL_TEXT_ATTR)).toMatch(/^Item \d+ quarterly/);
    }
    expect(doc.querySelector('title')).toBeNull();
  });

  it('a short name in a big cell stays one line', async () => {
    const svg = await renderForExport(
      'treemap Short\nAlpha 60\nBeta 40\n',
      'light',
      palette
    );
    const d = new new JSDOM('').window.DOMParser().parseFromString(
      svg,
      'image/svg+xml'
    );
    for (const l of d.querySelectorAll('.dgmo-treemap-label')) {
      expect(lineEls(l)).toHaveLength(1);
    }
  });
});
