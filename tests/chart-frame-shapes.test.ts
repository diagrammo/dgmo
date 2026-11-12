// The chart frame on the shape family (#1827): goal, countdown, clock,
// bracket, swot, body, raci, cycle, pyramid, ring, treemap. The every-type
// test puts the four lines last; this file pins what it cannot see.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderForExport } from '../src/d3';
import { parseGoal } from '../src/goal/parser';
import { parseCountdown } from '../src/countdown/parser';
import { parsePyramid } from '../src/pyramid/parser';
import { parseRing } from '../src/ring/parser';
import { parseCycle } from '../src/cycle/parser';
import { parseTreemap } from '../src/treemap/parser';
import { parseRaci } from '../src/raci/parser';

const FIXTURES = join(__dirname, 'fixtures/conformance');
const TYPES = [
  'goal',
  'countdown',
  'clock',
  'bracket',
  'swot',
  'body',
  'raci',
  'cycle',
  'pyramid',
  'ring',
  'treemap',
];

function fixture(type: string): string {
  return readFileSync(join(FIXTURES, `${type}.dgmo`), 'utf8');
}

describe('chart frame, shape family (#1827)', () => {
  for (const type of TYPES) {
    it(`${type}: a frame line right after the header is read, content still draws`, async () => {
      const lines = fixture(type).trimEnd().split('\n');
      // Header may follow a comment or blank; insert after the first non-blank,
      // non-comment line.
      const at = lines.findIndex((l) => l.trim() && !l.startsWith('//')) + 1;
      lines.splice(at, 0, 'subtitle Deck line up top', 'byline Chart: Test');
      const svg = await renderForExport(lines.join('\n'), 'light');
      const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window
        .document;
      expect(doc.querySelector('.chart-subtitle')?.textContent).toBe(
        'Deck line up top'
      );
      expect(doc.querySelector('.chart-byline')?.textContent).toBe(
        'Chart: Test'
      );
    });
  }

  it('treemap radial draws the frame', async () => {
    const [head, ...rest] = fixture('treemap').trimEnd().split('\n');
    const src = `${head}\nradial\n${rest.join('\n')}\nsubtitle Radial deck\nfootnote Radial note\n`;
    const svg = await renderForExport(src, 'light');
    const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window
      .document;
    expect(doc.querySelector('.dgmo-treemap-radial')).not.toBeNull();
    expect(doc.querySelector('.chart-subtitle')?.textContent).toBe(
      'Radial deck'
    );
    expect(doc.querySelector('.chart-footnote')?.textContent).toBe(
      'Radial note'
    );
  });

  it('a capitalised Source or Footnote stays a node', () => {
    const pyramid = parsePyramid('pyramid T\nSource\nFootnote\n');
    expect(pyramid.layers.map((l) => l.label)).toEqual(['Source', 'Footnote']);
    expect(pyramid.frame).toBeUndefined();

    const ring = parseRing('ring T\nSource\nFootnote\n');
    expect(ring.layers.map((l) => l.label)).toEqual(['Source', 'Footnote']);

    const cycle = parseCycle('cycle T\nSource\nFootnote\n');
    expect(cycle.nodes.map((n) => n.label)).toEqual(['Source', 'Footnote']);

    const treemap = parseTreemap('treemap T\nSource 5\nFootnote 3\n');
    expect(treemap.roots.map((n) => n.label)).toEqual(['Source', 'Footnote']);
    expect(treemap.frame).toBeUndefined();
  });

  it('a column-1 frame line closes the open layer or node', () => {
    const pyramid = parsePyramid('pyramid T\nTop\n  desc\nsource S\nBase\n');
    expect(pyramid.frame?.source).toBe('S');
    expect(pyramid.layers.map((l) => l.label)).toEqual(['Top', 'Base']);
    expect(pyramid.diagnostics).toEqual([]);
  });

  it('countdown keeps `note` as its caption and adds the frame', () => {
    const p = parseCountdown(
      'countdown T\ntarget 2099-01-01\nnote The caption\nsubtitle Deck\n'
    );
    expect(p.note).toContain('The caption');
    expect(p.frame?.subtitle).toBe('Deck');
  });

  it('goal reads a frame line after a note block', () => {
    const p = parseGoal(
      'goal T\nnow 3\ntarget 10\nnote Caption\n  more\nsubtitle Deck\n'
    );
    expect(p.description).toContain('Caption');
    expect(p.frame?.subtitle).toBe('Deck');
    expect(p.diagnostics.filter((d) => d.severity === 'warning')).toEqual([]);
  });

  it('raci reads a frame line between phases without an error', () => {
    const p = parseRaci(
      'raci T\nroles A, B\n\n[Phase]\n  Task\n    A: R\nsource Src\n'
    );
    expect(p.frame?.source).toBe('Src');
    expect(p.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});
