// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseJourneyMap } from '../src/journey-map/parser';
import { renderJourneyMapForExport } from '../src/journey-map/renderer';
import { CURVE_AREA_PANEL_GAP } from '../src/journey-map/layout';
import { getPalette } from '../src/palettes';

// #2447: the curve area's bottom frame and the phase panels (or step cards)
// never touch. The layout owns the area's bottom; the renderer draws to it.

const palette = getPalette('nord').light;

function build(opts: {
  directives: string[];
  emotions: boolean;
  phases: boolean;
  collapsed?: boolean;
}): string {
  const emo = (e: string) => (opts.emotions ? `, emotion: ${e}` : '');
  const steps = [
    `  Sign up score: 4${emo('Hopeful')}`,
    `  Verify email score: 1${emo('Annoyed')}`,
    `  First project score: 5${emo('Delighted')}`,
  ];
  const lines = ['journey-map Onboarding', ...opts.directives, ''];
  if (opts.phases) {
    lines.push(
      `[Signup]${opts.collapsed ? ' collapsed' : ''}`,
      ...steps.slice(0, 2)
    );
    lines.push('[Activation]', steps[2]!);
  } else {
    lines.push(...steps.map((s) => s.trim()));
  }
  return lines.join('\n');
}

function measure(src: string): { frameBottom: number; panelTops: number[] } {
  expect(parseJourneyMap(src, palette).error ?? null).toBeNull();
  const svg = renderJourneyMapForExport(src, 'light', palette);
  const doc = new JSDOM(svg).window.document;
  const frame = [...doc.querySelectorAll('.journey-curve-area path')].find(
    (p) =>
      p.getAttribute('fill') === 'none' && /^M/.test(p.getAttribute('d') ?? '')
  );
  expect(frame).toBeTruthy();
  const ys = [
    ...(frame!.getAttribute('d') ?? '').matchAll(/[ML][\d.-]+,([\d.-]+)/g),
  ].map((m) => Number(m[1]));
  const frameBottom = Math.max(...ys);
  const panels = [
    ...doc.querySelectorAll('.journey-phase > rect:first-of-type'),
  ];
  const cards =
    panels.length > 0
      ? panels
      : [...doc.querySelectorAll('.journey-step rect:first-of-type')];
  const panelTops = cards.map((r) => Number(r.getAttribute('y')));
  expect(panelTops.length).toBeGreaterThan(0);
  return { frameBottom, panelTops };
}

const directiveSets = [
  [],
  ['fill-outline'],
  ['fill-solid'],
  ['fill-tint'],
  ['fill-outline', 'no-legend', 'no-title'],
  ['no-legend'],
  ['no-title'],
];

describe('journey-map curve area clears the phase panels (#2447)', () => {
  for (const directives of directiveSets) {
    for (const emotions of [false, true]) {
      for (const [phases, collapsed] of [
        [true, false],
        [true, true],
        [false, false],
      ] as const) {
        const name = `${directives.join(' ') || 'defaults'} · emotions ${emotions} · phases ${phases}${collapsed ? ' (collapsed)' : ''}`;
        it(name, () => {
          const { frameBottom, panelTops } = measure(
            build({ directives, emotions, phases, collapsed })
          );
          for (const top of panelTops) {
            expect(top - frameBottom).toBeGreaterThanOrEqual(
              CURVE_AREA_PANEL_GAP
            );
          }
        });
      }
    }
  }
});
