import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseCountdown, targetToMs } from '../src/countdown/parser';
import { renderCountdown } from '../src/countdown/renderer';
import { tickCountdowns } from '../src/countdown/ticker';
import {
  resolveNext,
  ordinalFor,
  ordinalWord,
  formatCount,
  type RecurRule,
} from '../src/countdown/resolve';
import { render } from '../src/render';
import { getPalette } from '../src/palettes';
import { getRenderCategory } from '../src/dgmo-router';

// Determinism: the suite assumes TZ=UTC (set by the package test script / CI),
// so `2026-08-21` local midnight equals its UTC midnight and day counts are
// stable across environments.
const FIXED_NOW = Date.parse('2026-07-10T00:00:00Z');

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

afterEach(() => {
  vi.useRealTimers();
});

const nordLight = getPalette('nord').light;

function makeContainer(): HTMLDivElement {
  const c = document.createElement('div');
  Object.defineProperty(c, 'clientWidth', { value: 800 });
  Object.defineProperty(c, 'clientHeight', { value: 600 });
  return c as HTMLDivElement;
}

function valueNode(container: HTMLElement): SVGTextElement {
  const node = container.querySelector('[data-dgmo-countdown]');
  if (!node) throw new Error('no countdown marker node');
  return node as unknown as SVGTextElement;
}

function errors(diagnostics: readonly { severity: string }[]): unknown[] {
  return diagnostics.filter((d) => d.severity === 'error');
}

function renderAt(source: string, nowIso: string): HTMLDivElement {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(nowIso));
  const container = makeContainer();
  const parsed = parseCountdown(source);
  renderCountdown(container, parsed, nordLight, false, {
    width: 800,
    height: 600,
  });
  return container;
}

// ============================================================
// Parser — one-shot
// ============================================================

describe('countdown parser — one-shot', () => {
  it('parses title + target date; defaults units=days round=up expired=Now!', () => {
    const r = parseCountdown(`countdown Trip to Japan\ntarget 2026-08-21`);
    expect(r.type).toBe('countdown');
    expect(r.title).toBe('Trip to Japan');
    expect(r.target).toBe('2026-08-21');
    expect(r.rule).toBeNull();
    expect(r.units).toBe('days');
    expect(r.round).toBe('up');
    expect(r.expired).toBe('Now!');
    expect(r.error).toBeNull();
    expect(errors(r.diagnostics)).toHaveLength(0);
  });

  it('parses units full + custom expired', () => {
    const r = parseCountdown(
      `countdown Launch\ntarget 2026-09-01T09:00\nunits full\nexpired 🚀 Shipped!`
    );
    expect(r.units).toBe('full');
    expect(r.expired).toBe('🚀 Shipped!');
    expect(r.hasTime).toBe(true);
  });

  it('rejects a bad target with a non-fatal error diagnostic', () => {
    const r = parseCountdown(`countdown Bad\ntarget not-a-date`);
    expect(r.error).toBeNull();
    expect(errors(r.diagnostics).length).toBeGreaterThan(0);
    expect(r.resolvedMs).toBeNull();
  });

  it('errors when neither target nor every is present', () => {
    const r = parseCountdown(`countdown No target`);
    expect(errors(r.diagnostics).length).toBeGreaterThan(0);
  });

  it('fails hard on a wrong first line', () => {
    const r = parseCountdown(`flowchart X\ntarget 2026-08-21`);
    expect(r.error).not.toBeNull();
  });

  it('resolves `now` to a fixed instant (immediately expired)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const r = parseCountdown(`countdown Test\ntarget now`);
    expect(r.resolvedMs).toBe(FIXED_NOW);
    expect(r.target).not.toBe('now');
  });

  it('warns on indented content', () => {
    const r = parseCountdown(`countdown X\ntarget 2026-08-21\n  stray`);
    expect(r.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
  });
});

describe('targetToMs', () => {
  it('treats a bare date as local midnight', () => {
    expect(targetToMs('2026-08-21')).toBe(new Date(2026, 7, 21).getTime());
  });
  it('returns null for garbage', () => {
    expect(targetToMs('nope')).toBeNull();
  });
});

// ============================================================
// Parser — recurring grammar
// ============================================================

describe('countdown parser — recurring', () => {
  it('every year on Aug 21 → month-day rule', () => {
    const r = parseCountdown(`countdown Birthday\nevery year on Aug 21`);
    expect(r.rule).toEqual(
      expect.objectContaining({ kind: 'month-day', month: 7, day: 21, hour: 0 })
    );
    expect(r.target).toBeNull();
    expect(errors(r.diagnostics)).toHaveLength(0);
  });

  it('every month on 3rd Tuesday at 18:00 → nth-weekday rule', () => {
    const r = parseCountdown(
      `countdown Meetup\nevery month on 3rd Tuesday at 18:00`
    );
    expect(r.rule).toEqual(
      expect.objectContaining({
        kind: 'nth-weekday',
        nth: 3,
        weekday: 2,
        hour: 18,
      })
    );
    expect(r.hasTime).toBe(true);
  });

  it('every month on last Friday → last-weekday rule', () => {
    const r = parseCountdown(`countdown Retro\nevery month on last Friday`);
    expect(r.rule).toEqual(
      expect.objectContaining({ kind: 'last-weekday', weekday: 5 })
    );
  });

  it('every week on Friday → weekly rule', () => {
    const r = parseCountdown(`countdown Standup\nevery week on Friday`);
    expect(r.rule).toEqual(
      expect.objectContaining({ kind: 'weekly', weekday: 5 })
    );
  });

  it('every 2 weeks from 2026-07-03 → interval rule', () => {
    const r = parseCountdown(`countdown Sprint\nevery 2 weeks from 2026-07-03`);
    expect(r.rule).toEqual(
      expect.objectContaining({
        kind: 'interval',
        intervalN: 2,
        intervalUnit: 'week',
      })
    );
    expect(r.rule?.anchorMs).toBe(new Date(2026, 6, 3).getTime());
  });

  it('rejects both target and every', () => {
    const r = parseCountdown(
      `countdown Both\ntarget 2026-08-21\nevery year on Aug 21`
    );
    expect(errors(r.diagnostics).length).toBeGreaterThan(0);
  });

  it('errors on `every year` without an `on`', () => {
    const r = parseCountdown(`countdown X\nevery year`);
    expect(errors(r.diagnostics).length).toBeGreaterThan(0);
  });
});

describe('countdown parser — §2.4 free-prose rejection', () => {
  it('rejects "every Friday 6pm" with a 24h fix + cadence hint', () => {
    const r = parseCountdown(`countdown X\nevery Friday 6pm`);
    const errs = r.diagnostics.filter((d) => d.severity === 'error');
    expect(errs.length).toBeGreaterThan(0);
    const msg = errs.map((e) => e.message).join(' ');
    expect(msg).toContain('18:00');
    expect(msg.toLowerCase()).toContain('every week on friday');
  });

  it('rejects am/pm on an `at` line with the 24h form', () => {
    const r = parseCountdown(`countdown X\nevery week on Friday\nat 6pm`);
    const msg = r.diagnostics.map((e) => e.message).join(' ');
    expect(msg).toContain('18:00');
  });
});

// ============================================================
// resolve — next instant + roll-forward + ordinal
// ============================================================

describe('resolveNext', () => {
  const now = Date.parse('2026-07-10T00:00:00Z');

  it('month-day resolves to this year when still ahead', () => {
    const rule: RecurRule = {
      kind: 'month-day',
      month: 7,
      day: 21,
      hour: 0,
      minute: 0,
    };
    expect(resolveNext(rule, now)).toBe(new Date(2026, 7, 21).getTime());
  });

  it('month-day rolls to next year once passed', () => {
    const rule: RecurRule = {
      kind: 'month-day',
      month: 0,
      day: 1,
      hour: 0,
      minute: 0,
    };
    expect(resolveNext(rule, now)).toBe(new Date(2027, 0, 1).getTime());
  });

  it('nth-weekday: 3rd Tuesday of a month', () => {
    // July 2026: Tuesdays fall on 7, 14, 21, 28 → 3rd is the 21st.
    const rule: RecurRule = {
      kind: 'nth-weekday',
      nth: 3,
      weekday: 2,
      hour: 18,
      minute: 0,
    };
    expect(resolveNext(rule, now)).toBe(new Date(2026, 6, 21, 18, 0).getTime());
  });

  it('last-weekday: last Friday of July 2026 is the 31st', () => {
    const rule: RecurRule = {
      kind: 'last-weekday',
      weekday: 5,
      hour: 0,
      minute: 0,
    };
    expect(resolveNext(rule, now)).toBe(new Date(2026, 6, 31).getTime());
  });

  it('weekly: next Friday after 2026-07-10 (a Friday) is a week out', () => {
    const rule: RecurRule = { kind: 'weekly', weekday: 5, hour: 0, minute: 0 };
    // now is exactly Fri 00:00 → strictly-after picks next Friday.
    expect(resolveNext(rule, now)).toBe(new Date(2026, 6, 17).getTime());
  });

  it('interval: 2 weeks from an anchor', () => {
    const rule: RecurRule = {
      kind: 'interval',
      intervalN: 2,
      intervalUnit: 'week',
      anchorMs: new Date(2026, 6, 3).getTime(),
      hour: 0,
      minute: 0,
    };
    // 2026-07-03 + 14d = 07-17 (> now).
    expect(resolveNext(rule, now)).toBe(new Date(2026, 6, 17).getTime());
  });
});

describe('ordinal math', () => {
  it('resolvedYear − since', () => {
    expect(ordinalFor(new Date(2026, 5, 14).getTime(), 2019)).toBe(7);
  });
  it('ordinalWord', () => {
    expect(ordinalWord(1)).toBe('1st');
    expect(ordinalWord(2)).toBe('2nd');
    expect(ordinalWord(3)).toBe('3rd');
    expect(ordinalWord(7)).toBe('7th');
    expect(ordinalWord(21)).toBe('21st');
    expect(ordinalWord(11)).toBe('11th');
  });
});

describe('formatCount — round modes', () => {
  const DAY = 86_400_000;
  it('days up = ceil (a target later today reads 1)', () => {
    expect(
      formatCount(0.3 * DAY, { units: 'days', round: 'up', fields: [] })
    ).toBe('1 day');
  });
  it('days down = floor', () => {
    expect(
      formatCount(2.9 * DAY, { units: 'days', round: 'down', fields: [] })
    ).toBe('2 days');
  });
  it('days nearest = round', () => {
    expect(
      formatCount(2.4 * DAY, { units: 'days', round: 'nearest', fields: [] })
    ).toBe('2 days');
    expect(
      formatCount(2.6 * DAY, { units: 'days', round: 'nearest', fields: [] })
    ).toBe('3 days');
  });
  it('weeks', () => {
    expect(
      formatCount(20 * DAY, { units: 'weeks', round: 'up', fields: [] })
    ).toBe('3 weeks');
  });
  it('clock exceeds 24h', () => {
    expect(
      formatCount(26 * 3600 * 1000 + 61_000, {
        units: 'clock',
        round: 'up',
        fields: [],
      })
    ).toBe('26:01:01');
  });
  it('full prunes seconds via fields', () => {
    const ms = 3 * DAY + 6 * 3600_000 + 14 * 60_000 + 3000;
    expect(
      formatCount(ms, { units: 'full', round: 'up', fields: ['d', 'h', 'm'] })
    ).toBe('3d 06:14');
  });
  it('words', () => {
    expect(
      formatCount(6 * DAY, { units: 'words', round: 'up', fields: [] })
    ).toBe('in 6 days');
  });
});

// ============================================================
// Renderer — baked markers, footer, as-of stamp
// ============================================================

describe('countdown renderer — baked markers', () => {
  it('bakes a whole-day count + data-* attrs, footer, as-of stamp, no <script>', () => {
    const c = renderAt(
      `countdown Trip\ntarget 2026-08-21`,
      '2026-07-10T00:00:00Z'
    );
    const node = valueNode(c);
    expect(node.getAttribute('data-dgmo-countdown')).toBe('2026-08-21');
    expect(node.getAttribute('data-dgmo-countdown-units')).toBe('days');
    expect(node.textContent).toBe('42 days'); // 2026-07-10 → 2026-08-21
    expect(
      c.querySelector('[data-dgmo-countdown-footer]')?.textContent
    ).toContain('Aug 21 2026');
    expect(
      c.querySelector('[data-dgmo-countdown-asof]')?.textContent
    ).toContain('as of');
    expect(c.querySelector('script')).toBeNull();
  });

  it('bakes expired text when a one-shot target has passed', () => {
    const c = renderAt(
      `countdown Gone\ntarget 2026-08-21\nexpired Done`,
      '2026-12-01T00:00:00Z'
    );
    expect(valueNode(c).textContent).toBe('Done');
  });

  it('recurring: bakes resolved instant + structured recur attrs', () => {
    const c = renderAt(
      `countdown Meetup\nevery month on 3rd Tuesday at 18:00`,
      '2026-07-10T00:00:00Z'
    );
    const node = valueNode(c);
    expect(node.getAttribute('data-dgmo-recur-kind')).toBe('nth-weekday');
    expect(node.getAttribute('data-dgmo-recur-nth')).toBe('3');
    expect(node.getAttribute('data-dgmo-recur-weekday')).toBe('2');
    expect(node.getAttribute('data-dgmo-recur-hour')).toBe('18');
    // 3rd Tuesday of July 2026 is the 21st.
    expect(node.getAttribute('data-dgmo-countdown')).toContain('2026-07-21');
  });

  it('since eyebrow: bakes the ordinal eyebrow', () => {
    const c = renderAt(
      `countdown Anniversary\nevery year on Jun 14\nsince 2019\nsince-label anniversary`,
      '2026-07-10T00:00:00Z'
    );
    // Next Jun 14 is 2027 → 2027 − 2019 = 8th.
    const eyebrow = c.querySelector('[data-dgmo-countdown-eyebrow]');
    expect(eyebrow?.textContent).toBe('8TH ANNIVERSARY');
  });
});

// ============================================================
// Ticker — live update, roll-forward, stamp erasure
// ============================================================

describe('countdown ticker', () => {
  it('days mode: rewrites textContent + aria-label from the absolute target', () => {
    const c = renderAt(
      `countdown Trip\ntarget 2026-08-21`,
      '2026-07-10T00:00:00Z'
    );
    vi.setSystemTime(Date.parse('2026-08-01T00:00:00Z'));
    tickCountdowns(c);
    expect(valueNode(c).textContent).toBe('20 days');
    expect(valueNode(c).getAttribute('aria-label')).toContain('Trip');
  });

  it('full mode: upgrades to Nd HH:MM:SS', () => {
    const c = renderAt(
      `countdown Launch\ntarget 2026-08-21T00:00:00Z\nunits full`,
      '2026-07-10T00:00:00Z'
    );
    vi.setSystemTime(Date.parse('2026-08-17T17:45:57Z'));
    tickCountdowns(c);
    expect(valueNode(c).textContent).toBe('3d 06:14:03');
  });

  it('one-shot: shows expired text once passed', () => {
    const c = renderAt(
      `countdown Gone\ntarget 2026-08-21\nexpired 🎉`,
      '2026-07-10T00:00:00Z'
    );
    vi.setSystemTime(Date.parse('2026-09-01T00:00:00Z'));
    tickCountdowns(c);
    expect(valueNode(c).textContent).toBe('🎉');
  });

  it('recurring rolls forward: past the occurrence it counts to the next one', () => {
    const c = renderAt(
      `countdown Birthday\nevery year on Aug 21`,
      '2026-07-10T00:00:00Z'
    );
    // Move past this year's Aug 21 → ticker resolves to 2027-08-21.
    vi.setSystemTime(Date.parse('2026-09-01T00:00:00Z'));
    tickCountdowns(c);
    expect(
      c.querySelector('[data-dgmo-countdown-footer]')?.textContent
    ).toContain('Aug 21 2027');
  });

  it('headline style: the ordinal stays the hero after a tick (not a day count)', () => {
    const c = renderAt(
      `countdown Anniversary\nevery year on Jun 14\nsince 2019\nsince-style headline`,
      '2026-07-10T00:00:00Z'
    );
    // Next Jun 14 is 2027 → 8th; the hero must remain "8th", not "338 days".
    expect(valueNode(c).textContent).toBe('8th');
    vi.setSystemTime(Date.parse('2026-07-11T00:00:00Z'));
    tickCountdowns(c);
    expect(valueNode(c).textContent).toBe('8th');
  });

  it('erases the "as of" stamp on the first tick', () => {
    const c = renderAt(
      `countdown Trip\ntarget 2026-08-21`,
      '2026-07-10T00:00:00Z'
    );
    expect(c.querySelector('[data-dgmo-countdown-asof]')).not.toBeNull();
    vi.setSystemTime(Date.parse('2026-07-11T00:00:00Z'));
    tickCountdowns(c);
    expect(c.querySelector('[data-dgmo-countdown-asof]')).toBeNull();
  });
});

// ============================================================
// Registry / render() integration
// ============================================================

describe('countdown registry + render()', () => {
  it('is a visualization chart type', () => {
    expect(getRenderCategory('countdown')).toBe('visualization');
  });

  it('render() bakes the marker into the SVG string, no <script>', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const { svg, diagnostics } = await render(
      `countdown Trip to Japan\ntarget 2026-08-21`,
      { palette: 'nord', theme: 'light' }
    );
    vi.useRealTimers();
    expect(errors(diagnostics)).toHaveLength(0);
    expect(svg).toContain('data-dgmo-countdown="2026-08-21"');
    expect(svg).not.toContain('<script');
  });
});
