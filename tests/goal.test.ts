import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseGoal } from '../src/goal/parser';
import { renderGoal } from '../src/goal/renderer';
import { render } from '../src/render';
import { getPalette } from '../src/palettes';
import { mix, themeBaseBg } from '../src/palettes/color-utils';
import { resolveColor } from '../src/colors';
import { getRenderCategory } from '../src/dgmo-router';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const [key, value] of Object.entries({
    document: win.document,
    window: win,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
  })) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
});

const nordLight = getPalette('nord').light;

function makeContainer(): HTMLDivElement {
  const c = document.createElement('div');
  Object.defineProperty(c, 'clientWidth', { value: 800 });
  Object.defineProperty(c, 'clientHeight', { value: 600 });
  return c as HTMLDivElement;
}

function texts(svg: SVGSVGElement): string[] {
  return Array.from(svg.querySelectorAll('text')).map(
    (t) => t.textContent ?? ''
  );
}

function errors(diagnostics: readonly { severity: string }[]): unknown[] {
  return diagnostics.filter((d) => d.severity === 'error');
}

// ============================================================
// Parser
// ============================================================

describe('goal parser — basic', () => {
  it('parses title, now, target, default bar mode', () => {
    const r = parseGoal(`goal Books this month
now 3
target 5`);
    expect(r.type).toBe('goal');
    expect(r.title).toBe('Books this month');
    expect(r.mode).toBe('bar');
    expect(r.now).toBe(3);
    expect(r.target).toBe(5);
    expect(r.hasTarget).toBe(true);
    expect(r.error).toBeNull();
    expect(errors(r.diagnostics)).toHaveLength(0);
  });

  it('selects thermometer mode via bare flag', () => {
    const r = parseGoal(`goal Marathon Fund ($)
thermometer
now 6400
target 10000`);
    expect(r.mode).toBe('thermometer');
    expect(r.now).toBe(6400);
    expect(r.target).toBe(10000);
  });

  it('selects gauge mode via bare flag', () => {
    const r = parseGoal(`goal Quarterly Quota
gauge
now 64
target 100`);
    expect(r.mode).toBe('gauge');
  });

  it('honors underscore and comma grouping separators', () => {
    const ok = parseGoal(`goal Fund\nnow 6_400\ntarget 10_000`);
    expect(ok.now).toBe(6400);
    expect(ok.target).toBe(10000);

    // Commas group thousands here just as they do on bar/pie/funnel/treemap.
    const commas = parseGoal(`goal Fund\nnow 6,400\ntarget 1,000,000`);
    expect(errors(commas.diagnostics).length).toBe(0);
    expect(commas.now).toBe(6400);
    expect(commas.target).toBe(1000000);

    // Malformed grouping is still rejected rather than truncated to `6`.
    const bad = parseGoal(`goal Fund\nnow 6,40\ntarget 10000`);
    expect(errors(bad.diagnostics).length).toBeGreaterThan(0);
  });

  it('peels a trailing color token from the title (§1.5)', () => {
    const r = parseGoal(`goal Marathon Fund ($) green\nnow 1\ntarget 2`);
    expect(r.title).toBe('Marathon Fund ($)');
    expect(r.color).toBeDefined();
  });

  it('rejects a non-goal first line', () => {
    const r = parseGoal(`pyramid Nope\nnow 1\ntarget 2`);
    expect(r.error).toMatch(/Expected "goal/);
  });
});

describe('goal parser — options', () => {
  it('parses no-percent / no-value / fill-solid / no-title flags', () => {
    const r = parseGoal(`goal T
no-percent
no-value
fill-solid
no-title
now 1
target 4`);
    expect(r.options.noPercent).toBe(true);
    expect(r.options.noValue).toBe(true);
    expect(r.options.fillMode).toBe('solid');
    expect(r.options.noTitle).toBe(true);
  });

  it('parses no-note flag (defaults false)', () => {
    expect(parseGoal(`goal T\nnow 1\ntarget 4`).options.noNote).toBe(false);
    const r = parseGoal(`goal T\nno-note\nnow 1\ntarget 4\nnote\n  hi crew`);
    expect(r.options.noNote).toBe(true);
    expect(r.description).toBe('hi crew');
  });

  it('parses canonical no-notes flag (decision #48; no-note stays legacy)', () => {
    const r = parseGoal(`goal T\nno-notes\nnow 1\ntarget 4\nnote\n  hi crew`);
    expect(r.options.noNote).toBe(true);
    expect(r.description).toBe('hi crew');
    // Neither spelling falls through to the unrecognized-line warning.
    expect(r.diagnostics).toHaveLength(0);
  });

  it('parses no-auto-color flag (defaults false)', () => {
    expect(parseGoal(`goal T\nnow 1\ntarget 4`).options.noAutoColor).toBe(
      false
    );
    const r = parseGoal(`goal T\nno-auto-color\nnow 1\ntarget 4`);
    expect(r.options.noAutoColor).toBe(true);
  });

  it('parses a `note` free-text description', () => {
    const r = parseGoal(`goal T
thermometer
now 34
target 50
note Great job crew, one more push to the goal`);
    expect(r.description).toBe('Great job crew, one more push to the goal');
    expect(r.diagnostics.some((d) => /Unrecognized/.test(d.message))).toBe(
      false
    );
  });

  it('description defaults to null', () => {
    const r = parseGoal(`goal T\nnow 1\ntarget 4`);
    expect(r.description).toBeNull();
  });

  it('parses a `note` block with indented multi-line markdown body', () => {
    const r = parseGoal(`goal T
now 1
target 4
note
  Great Job! We just need reports from:
  - Seattle
  - Columbus *almost there!*`);
    expect(r.description).toBe(
      'Great Job! We just need reports from:\n- Seattle\n- Columbus *almost there!*'
    );
    expect(r.diagnostics.some((d) => /Indented content/.test(d.message))).toBe(
      false
    );
    expect(r.diagnostics.some((d) => /Unrecognized/.test(d.message))).toBe(
      false
    );
  });

  it('warns on indented content (single-value type)', () => {
    const r = parseGoal(`goal T\nnow 1\ntarget 4\n  child ignored`);
    expect(r.diagnostics.some((d) => /Indented content/.test(d.message))).toBe(
      true
    );
  });
});

describe('goal parser — edge cases', () => {
  it('missing target → error diagnostic but no fatal error (shell renders)', () => {
    const r = parseGoal(`goal T\nnow 3`);
    expect(r.hasTarget).toBe(false);
    expect(r.error).toBeNull();
    expect(errors(r.diagnostics).length).toBeGreaterThan(0);
  });

  it('target ≤ 0 → error diagnostic, hasTarget false', () => {
    const r = parseGoal(`goal T\nnow 3\ntarget 0`);
    expect(r.hasTarget).toBe(false);
    expect(errors(r.diagnostics).length).toBeGreaterThan(0);
  });

  it('missing now → warning, treated as 0', () => {
    const r = parseGoal(`goal T\ntarget 5`);
    expect(r.now).toBe(0);
    expect(
      r.diagnostics.some(
        (d) => d.severity === 'warning' && /now/.test(d.message)
      )
    ).toBe(true);
  });
});

// ============================================================
// Router
// ============================================================

describe('goal router', () => {
  it('goal is a visualization render category', () => {
    expect(getRenderCategory('goal')).toBe('visualization');
  });
});

// ============================================================
// Renderer
// ============================================================

describe('goal renderer — faces', () => {
  it('bar: renders track + fill rects and truthful labels', () => {
    const parsed = parseGoal(`goal Books\nnow 3\ntarget 5`);
    const c = makeContainer();
    renderGoal(c, parsed, nordLight, false);
    const svg = c.querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.querySelectorAll('rect').length).toBeGreaterThanOrEqual(3); // bg + track + fill
    const all = texts(svg).join(' ');
    // Bar shows the raw now value (inside the fill) + target (right of bar).
    expect(all).toContain('3');
    expect(all).toContain('5');
  });

  it('thermometer: renders bulb + column silhouette and % label', () => {
    const parsed = parseGoal(`goal Fund\nthermometer\nnow 6400\ntarget 10000`);
    const c = makeContainer();
    renderGoal(c, parsed, nordLight, false);
    const svg = c.querySelector('svg')!;
    expect(
      svg.querySelectorAll('.goal-thermometer path').length
    ).toBeGreaterThanOrEqual(2); // glass track + mercury
    expect(texts(svg).join(' ')).toContain('64%');
  });

  it('gauge: renders arc paths + needle', () => {
    const parsed = parseGoal(`goal Quota\ngauge\nnow 64\ntarget 100`);
    const c = makeContainer();
    renderGoal(c, parsed, nordLight, false);
    const svg = c.querySelector('svg')!;
    expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(2); // track + value arc
    expect(svg.querySelectorAll('line').length).toBeGreaterThanOrEqual(1); // needle
    // The gauge shows the raw now value big in the arc belly, not a percentage.
    const gaugeText = texts(svg).join(' ');
    expect(gaugeText).toContain('64');
    expect(gaugeText).not.toContain('%');
  });

  it('gauge fill above 50% uses the minor arc, not the reflex circle', () => {
    // Regression: the semicircle sweep never exceeds 180°, so the SVG arc
    // large-arc flag must always be 0. A >0.5 test drew the reflex (major) arc
    // for any fill above 50%, ballooning it into a near-full circle.
    const parsed = parseGoal(`goal Quota\ngauge\nnow 64\ntarget 100`);
    const c = makeContainer();
    renderGoal(c, parsed, nordLight, false);
    const svg = c.querySelector('svg')!;
    const arcs = Array.from(svg.querySelectorAll('.goal-gauge path'));
    expect(arcs.length).toBeGreaterThanOrEqual(2);
    for (const p of arcs) {
      // "M x y A rx ry x-rot large-arc sweep x y" — the 6th A-param is large-arc.
      const m = p.getAttribute('d')!.match(/A\s+\S+\s+\S+\s+\S+\s+(\d)\s+\d/);
      expect(m?.[1]).toBe('0');
    }
  });

  it('over-target: bar fill clamps to the track width', () => {
    const parsed = parseGoal(`goal Stretch\nnow 6\ntarget 5`);
    const c = makeContainer();
    renderGoal(c, parsed, nordLight, false);
    const svg = c.querySelector('svg')!;
    const fill = Array.from(svg.querySelectorAll('rect'))[2]!; // bg, track, fill
    const track = Array.from(svg.querySelectorAll('rect'))[1]!;
    expect(parseFloat(fill.getAttribute('width')!)).toBeLessThanOrEqual(
      parseFloat(track.getAttribute('width')!) + 0.5
    );
    expect(texts(svg).join(' ')).toContain('6'); // raw now value, uncapped
  });

  it('no-percent / no-value suppress their labels', () => {
    const parsed = parseGoal(`goal T\nno-percent\nno-value\nnow 1\ntarget 4`);
    const c = makeContainer();
    renderGoal(c, parsed, nordLight, false);
    const all = texts(c.querySelector('svg')!).join(' ');
    expect(all).not.toContain('25%');
    expect(all).not.toContain('1 / 4');
  });

  it('missing target still renders a shell (track rect + now value)', () => {
    const parsed = parseGoal(`goal T\nnow 3`);
    const c = makeContainer();
    renderGoal(c, parsed, nordLight, false);
    const svg = c.querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.querySelectorAll('rect').length).toBeGreaterThanOrEqual(2); // bg + track
    expect(texts(svg).join(' ')).toContain('3');
  });

  it('bar fill-outline: meter renders hollow with the band color on the border', () => {
    // 3/5 = 60% → auto traffic-light band is orange; in outline mode that
    // color moves to the border and the meter interior is the theme base bg.
    const parsed = parseGoal(`goal Books\nfill-outline\nnow 3\ntarget 5`);
    const c = makeContainer();
    renderGoal(c, parsed, nordLight, false);
    const svg = c.querySelector('svg')!;
    const meter = Array.from(svg.querySelectorAll('rect'))[2]!; // bg, track, fill
    const band = resolveColor('orange', nordLight);
    expect(meter.getAttribute('fill')).toBe(themeBaseBg(nordLight, false));
    expect(meter.getAttribute('stroke')).toBe(band);
    expect(meter.getAttribute('stroke-width')).toBe('1.5');
  });

  it('bar default (no fill directive) keeps the 25%-tint meter unchanged', () => {
    const parsed = parseGoal(`goal Books\nnow 3\ntarget 5`);
    const c = makeContainer();
    renderGoal(c, parsed, nordLight, false);
    const svg = c.querySelector('svg')!;
    const meter = Array.from(svg.querySelectorAll('rect'))[2]!;
    const band = resolveColor('orange', nordLight);
    expect(meter.getAttribute('fill')).toBe(
      mix(band, themeBaseBg(nordLight, false), 25)
    );
    expect(meter.getAttribute('stroke')).toBe(band);
    expect(meter.getAttribute('stroke-width')).toBe('2');
  });

  it('thermometer fill-outline: mercury renders hollow, band color on the stroke', () => {
    // 6400/10000 = 64% → orange band.
    const parsed = parseGoal(
      `goal Fund\nthermometer\nfill-outline\nnow 6400\ntarget 10000`
    );
    const c = makeContainer();
    renderGoal(c, parsed, nordLight, false);
    const svg = c.querySelector('svg')!;
    const paths = Array.from(svg.querySelectorAll('.goal-thermometer path'));
    const mercury = paths[1]!; // glass track, then mercury
    const band = resolveColor('orange', nordLight);
    expect(mercury.getAttribute('fill')).toBe(themeBaseBg(nordLight, false));
    expect(mercury.getAttribute('stroke')).toBe(band);
    expect(mercury.getAttribute('stroke-width')).toBe('1.5');
  });

  it('gauge fill-outline: value band renders hollow with a colored rim', () => {
    // 64/100 = 64% → orange band. Outline mode draws the value arc twice:
    // full-width band in the band color, then 3px narrower in the theme base
    // bg — a hollow band with a ~1.5px rim whose extent reads the progress.
    const parsed = parseGoal(
      `goal Quota\ngauge\nfill-outline\nnow 64\ntarget 100`
    );
    const c = makeContainer();
    renderGoal(c, parsed, nordLight, false);
    const svg = c.querySelector('svg')!;
    const arcs = Array.from(svg.querySelectorAll('.goal-gauge path'));
    expect(arcs.length).toBeGreaterThanOrEqual(3); // track + rim + hollow
    const band = resolveColor('orange', nordLight);
    const rim = arcs.find((p) => p.getAttribute('stroke') === band)!;
    expect(rim).toBeTruthy();
    expect(rim.getAttribute('stroke-width')).toBe('36');
    const hollow = arcs.find(
      (p) => p.getAttribute('stroke') === themeBaseBg(nordLight, false)
    )!;
    expect(hollow).toBeTruthy();
    expect(hollow.getAttribute('stroke-width')).toBe('33');
    expect(hollow.getAttribute('d')).toBe(rim.getAttribute('d'));
  });

  it('gauge default keeps a single tinted value arc unchanged', () => {
    const parsed = parseGoal(`goal Quota\ngauge\nnow 64\ntarget 100`);
    const c = makeContainer();
    renderGoal(c, parsed, nordLight, false);
    const svg = c.querySelector('svg')!;
    const arcs = Array.from(svg.querySelectorAll('.goal-gauge path'));
    expect(arcs.length).toBe(2); // track + value arc only
    const band = resolveColor('orange', nordLight);
    expect(arcs[1]!.getAttribute('stroke')).toBe(
      mix(band, themeBaseBg(nordLight, false), 25)
    );
    expect(arcs[1]!.getAttribute('stroke-width')).toBe('36');
  });

  it('sets an aria-label describing the goal', () => {
    const parsed = parseGoal(`goal Books\nnow 3\ntarget 5`);
    const c = makeContainer();
    renderGoal(c, parsed, nordLight, false);
    expect(c.querySelector('svg')!.getAttribute('aria-label')).toBe(
      'Books: 3 of 5 (60%)'
    );
  });
});

// ============================================================
// End-to-end via the real render() pipeline (routing → handler)
// ============================================================

describe('goal render() pipeline', () => {
  it('routes each face through renderForExport and emits a real SVG', async () => {
    for (const src of [
      `goal Books\nnow 3\ntarget 5`,
      `goal Fund ($)\nthermometer\nnow 6400\ntarget 10000`,
      `goal Quota\ngauge\nnow 64\ntarget 100`,
    ]) {
      const { svg } = await render(src, { theme: 'light', palette: 'slate' });
      expect(svg).toMatch(/<svg/);
      expect(svg).toContain('aria-label');
      expect(svg).not.toMatch(/Parse error/i);
    }
  });

  it('over-target renders (no error card) with a truthful 120% label', async () => {
    const { svg } = await render(`goal Stretch\nnow 6\ntarget 5`);
    expect(svg).toContain('120%');
    expect(svg).not.toMatch(/Parse error/i);
  });

  it('missing target surfaces an error-card via render() (error diagnostic)', async () => {
    const { svg, diagnostics } = await render(`goal Broken\nnow 3`);
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(svg).toMatch(/<svg/);
  });
});
