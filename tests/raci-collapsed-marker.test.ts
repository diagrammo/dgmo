import { describe, expect, it } from 'vitest';

import { parseRaci } from '../src/raci/parser';
import { collapsedRaciPhasesFromSource } from '../src/raci/collapse';
import { render } from '../src/render';
import { applyGroupHeaderCollapsedMarkerAtLine } from '../src/utils/collapse-marker';

// Source `collapsed` marker on a RACI `[Phase]` header (#1741), in every variant.

const VARIANT_BODY = {
  raci: ['    Dev: R', '    PM: A'],
  rasci: ['    Dev: R', '    PM: A', '    QA: S'],
  daci: ['    Dev: D', '    PM: A'],
} as const;

const src = (header: string, variant: keyof typeof VARIANT_BODY = 'raci') =>
  [
    'raci Project',
    '',
    header,
    '  Scope',
    ...VARIANT_BODY[variant],
    '[Build]',
    '  Code',
    ...VARIANT_BODY[variant],
  ].join('\n');
const SRC = src('[Plan]');
const PHASE_LINE = 3;

const plan = (text: string) =>
  parseRaci(text).phases.find((p) => p.lineNumber === PHASE_LINE);

async function svgOf(
  text: string,
  viewState?: { cs?: number[] }
): Promise<string> {
  const { svg } = await render(text, {
    format: 'svg',
    ...(viewState && { viewState }),
  });
  return svg;
}
const bars = (svg: string): number =>
  (svg.match(/dgmo-collapse-bar"/g) ?? []).length;
const toggles = (svg: string): Element[] => [
  ...new DOMParser()
    .parseFromString(svg, 'image/svg+xml')
    .querySelectorAll('[data-group-toggle]'),
];

describe('raci phase collapsed marker — parsing', () => {
  it.each([
    ['[Plan] collapsed', true],
    ['[Plan] collapsed: true', true],
    ['[Plan] collapsed: false', false],
    ['[Plan] blue collapsed', true],
    ['[Plan] blue collapsed: true', true],
    ['[Plan] blue, collapsed: true', true],
    ['[Plan]', false],
    ['[Plan] Collapsed', false],
  ])('%s → collapsed %s', (header, folded) => {
    const p = plan(src(header));
    expect(p?.displayName).toBe('Plan');
    expect(p?.collapsed ?? false).toBe(folded);
  });

  it('keeps the colour alongside the marker', () => {
    expect(plan(src('[Plan] blue collapsed'))?.color).toBe(
      plan(src('[Plan] blue'))?.color
    );
    expect(plan(src('[Plan] blue'))?.color).toBeTruthy();
  });

  it('a phase named `collapsed` stays a name', () => {
    const p = plan(src('[collapsed]'));
    expect(p?.displayName).toBe('collapsed');
    expect(p?.collapsed ?? false).toBe(false);
  });

  it.each(['raci', 'rasci', 'daci'] as const)(
    'works in the %s variant',
    (variant) => {
      const parsed = parseRaci(src('[Plan] collapsed', variant));
      expect(parsed.variant).toBe(variant);
      expect(parsed.phases[0]!.collapsed).toBe(true);
    }
  );

  it('source helper unions markers with runtime line numbers', () => {
    const parsed = parseRaci(src('[Plan] collapsed'));
    const planId = parsed.phases[0]!.id;
    const buildId = parsed.phases[1]!.id;
    expect([...collapsedRaciPhasesFromSource(parsed)]).toEqual([planId]);
    expect(
      [
        ...collapsedRaciPhasesFromSource(parsed, [
          parsed.phases[1]!.lineNumber,
        ]),
      ].sort()
    ).toEqual([planId, buildId].sort());
  });
});

describe('raci phase collapsed marker — static render', () => {
  it.each(['raci', 'rasci', 'daci'] as const)(
    '%s: folds by marker (one bar), none without',
    async (variant) => {
      expect(bars(await svgOf(src('[Plan] collapsed', variant)))).toBe(1);
      expect(bars(await svgOf(src('[Plan] collapsed: true', variant)))).toBe(1);
      expect(bars(await svgOf(src('[Plan]', variant)))).toBe(0);
    }
  );

  it('folds from viewState.cs line numbers too', async () => {
    expect(bars(await svgOf(SRC, { cs: [PHASE_LINE] }))).toBe(1);
    const buildLine = parseRaci(SRC).phases[1]!.lineNumber;
    expect(
      bars(await svgOf(src('[Plan] collapsed'), { cs: [buildLine] }))
    ).toBe(2);
  });

  it('toggle markup on both states, pointing at the header line', async () => {
    const planId = parseRaci(SRC).phases[0]!.id;
    for (const [text, expanded] of [
      [SRC, 'true'],
      [src('[Plan] collapsed'), 'false'],
    ] as const) {
      const t = toggles(await svgOf(text)).find(
        (e) => e.getAttribute('data-group-toggle') === planId
      )!;
      expect(t).toBeTruthy();
      expect(t.getAttribute('data-line-number')).toBe(String(PHASE_LINE));
      expect(t.getAttribute('aria-expanded')).toBe(expanded);
      expect(t.getAttribute('role')).toBe('button');
      expect(t.getAttribute('aria-label')).toBe('Plan');
      expect(t.hasAttribute('tabindex')).toBe(false);
    }
  });
});

describe('raci phase collapsed marker — helper round-trip', () => {
  it.each(['[Plan]', '[Plan] blue'])(
    'applyGroupHeaderCollapsedMarkerAtLine round-trips on %s',
    (header) => {
      const original = src(header);
      const folded = applyGroupHeaderCollapsedMarkerAtLine(
        original,
        PHASE_LINE,
        true
      );
      expect(plan(folded)?.collapsed).toBe(true);
      expect(plan(folded)?.color).toBe(plan(original)?.color);
      const back = applyGroupHeaderCollapsedMarkerAtLine(
        folded,
        PHASE_LINE,
        false
      );
      expect(back).toBe(original);
      expect(plan(back)?.collapsed ?? false).toBe(false);
    }
  );

  it.each(['[Plan] collapsed', '[Plan] blue collapsed'])(
    'a header already carrying the bare flag (%s): collapse no-op, expand strips',
    (header) => {
      const bare = src(header);
      expect(
        applyGroupHeaderCollapsedMarkerAtLine(bare, PHASE_LINE, true)
      ).toBe(bare);
      const back = applyGroupHeaderCollapsedMarkerAtLine(
        bare,
        PHASE_LINE,
        false
      );
      expect(back).toBe(src(header.replace(/ collapsed$/, '')));
      expect(plan(back)?.collapsed ?? false).toBe(false);
    }
  );
});
