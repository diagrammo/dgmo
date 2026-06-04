import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { renderBoxesAndLines } from '../src/boxes-and-lines/renderer';
import { getPalette } from '../src/palettes';
import { mix } from '../src/palettes/color-utils';

const P = getPalette('nord').light;
const DIMS = { width: 800, height: 600 };

async function render(
  src: string,
  opts?: { activeTagGroup?: string | null }
): Promise<SVGSVGElement> {
  const parsed = parseBoxesAndLines(src);
  const layout = await layoutBoxesAndLines(parsed);
  const el = document.createElement('div');
  renderBoxesAndLines(el, parsed, layout, P, false, {
    exportDims: DIMS,
    ...opts,
  });
  return el.querySelector('svg')!;
}

function nodeFor(svg: SVGSVGElement, label: string): SVGGElement {
  return svg.querySelector<SVGGElement>(`.bl-node[data-node-id="${label}"]`)!;
}

describe('boxes-and-lines renderer — value ramp', () => {
  it('emits data-value (incl "0") and never data-tag-value (AC14, AC22, AC24)', async () => {
    const svg = await render(
      'boxes-and-lines\nbox-metric Load\nAPI value: 50\nDB value: 0\nAPI -> DB'
    );
    const api = nodeFor(svg, 'API');
    const db = nodeFor(svg, 'DB');
    expect(api.getAttribute('data-value')).toBe('50');
    expect(db.getAttribute('data-value')).toBe('0');
    expect(api.getAttribute('data-tag-value')).toBeNull();
    expect(db.getAttribute('data-tag-value')).toBeNull();
  });

  it('renders the gradient ramp, active, when value present (AC13, AC25)', async () => {
    const svg = await render(
      'boxes-and-lines\nbox-metric Load\nA value: 10\nB value: 90\nA -> B'
    );
    const ramp = svg.querySelector('.dgmo-legend-gradient-ramp');
    expect(ramp).toBeTruthy();
    expect(ramp!.getAttribute('data-ramp-min')).toBe('0');
    expect(ramp!.getAttribute('data-ramp-max')).toBe('90');
  });

  it('anchors the ramp at data-min when values are negative (AC12)', async () => {
    const svg = await render(
      'boxes-and-lines\nA value: -20\nB value: 40\nA -> B'
    );
    const ramp = svg.querySelector('.dgmo-legend-gradient-ramp')!;
    expect(ramp.getAttribute('data-ramp-min')).toBe('-20');
    expect(ramp.getAttribute('data-ramp-max')).toBe('40');
  });

  it('survives a degenerate single-value ramp with no NaN (AC11)', async () => {
    const svg = await render('boxes-and-lines\nA value: 7\nB\nA -> B');
    expect(svg).toBeTruthy();
    const ramp = svg.querySelector('.dgmo-legend-gradient-ramp')!;
    // allNonNegative → min anchors at 0, max is the lone value.
    expect(ramp.getAttribute('data-ramp-min')).toBe('0');
    expect(ramp.getAttribute('data-ramp-max')).toBe('7');
    const a = nodeFor(svg, 'A').querySelector('rect')!;
    expect(a.getAttribute('fill')).not.toContain('NaN');
  });

  it('value-tints boxes and strokes them with the ramp hue (default = primary)', async () => {
    const svg = await render(
      'boxes-and-lines\nA value: 10\nB value: 90\nA -> B'
    );
    const b = nodeFor(svg, 'B').querySelector('rect')!;
    // No box-metric color → hue defaults to palette.primary.
    expect(b.getAttribute('stroke')).toBe(P.primary);
    // High value tints near full hue (distinct from the page bg).
    expect(b.getAttribute('fill')).not.toBe(P.bg);
  });

  it('honors a box-metric trailing color as the ramp hue (AC4)', async () => {
    const svg = await render(
      'boxes-and-lines\nbox-metric Heat red\nA value: 10\nB value: 90\nA -> B'
    );
    const b = nodeFor(svg, 'B').querySelector('rect')!;
    expect(b.getAttribute('stroke')).toBe(P.colors.red);
  });

  it('gives a no-value box the neutral fill while value is active (AC10)', async () => {
    const svg = await render('boxes-and-lines\nA value: 10\nB\nA -> B');
    const b = nodeFor(svg, 'B').querySelector('rect')!;
    const neutral = mix(P.bg, P.text, 95);
    expect(b.getAttribute('fill')).toBe(neutral);
  });

  it('leaves a tag-only diagram untouched — no gradient, first tag active (AC6)', async () => {
    const svg = await render(
      'boxes-and-lines\ntag Team t Backend blue, Frontend green\nA t: Backend\nB t: Frontend\nA -> B'
    );
    expect(svg.querySelector('.dgmo-legend-gradient-ramp')).toBeNull();
    // Tag tint applied — fill is the tag shape-fill, not the value-neutral fill.
    const a = nodeFor(svg, 'A').querySelector('rect')!;
    expect(a.getAttribute('stroke')).toMatch(/^#/);
    expect(a.getAttribute('fill')).not.toBe(mix(P.bg, P.text, 95));
  });

  it('active-tag <tag-group> switches off the value ramp (AC8)', async () => {
    const svg = await render(
      'boxes-and-lines\ntag Team t Backend blue, Frontend green\nbox-metric Load\nA value: 10, t: Backend\nB value: 90, t: Frontend\nA -> B',
      { activeTagGroup: 'Team' }
    );
    // Tag group active → boxes tinted by tag, gradient capsule not active.
    expect(svg.querySelector('.dgmo-legend-gradient-ramp')).toBeNull();
    const a = nodeFor(svg, 'A').querySelector('rect')!;
    expect(a.getAttribute('stroke')).toMatch(/^#/);
    expect(a.getAttribute('fill')).not.toBe(mix(P.bg, P.text, 95));
  });

  it('prints value text only when show-values is set (AC16)', async () => {
    const off = await render('boxes-and-lines\nA value: 42\nB\nA -> B');
    expect(off.querySelector('.bl-node-value')).toBeNull();
    const on = await render(
      'boxes-and-lines\nshow-values\nA value: 42\nB\nA -> B'
    );
    const valText = on.querySelector('.bl-node-value');
    expect(valText).toBeTruthy();
    // No box-metric → bare number.
    expect(valText!.textContent).toBe('42');
  });

  it('prefixes the value with the metric label ("Crew: 120") on plain nodes (AC16)', async () => {
    const svg = await render(
      'boxes-and-lines\nbox-metric Crew\nshow-values\nFlagship value: 120\nSloop value: 12\nFlagship -> Sloop'
    );
    const flagship = nodeFor(svg, 'Flagship');
    const valText = flagship.querySelector('.bl-node-value')!;
    expect(valText.textContent).toBe('Crew: 120');
    // A thin divider sits between the title and the value line.
    expect(flagship.querySelector('line')).toBeTruthy();
  });
});
