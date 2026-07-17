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
  formatHuman,
  splitClockSeconds,
  type RecurRule,
} from '../src/countdown/resolve';
import { render } from '../src/render';
import { getPalette } from '../src/palettes';
import { contrastText, mix, themeBaseBg } from '../src/palettes/color-utils';
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
  it('parses title + target date; defaults units=human round=up expired=null, band on', () => {
    const r = parseCountdown(`countdown Trip to Japan\ntarget 2026-08-21`);
    expect(r.type).toBe('countdown');
    expect(r.title).toBe('Trip to Japan');
    expect(r.target).toBe('2026-08-21');
    expect(r.rule).toBeNull();
    expect(r.units).toBe('human');
    expect(r.round).toBe('up');
    expect(r.expired).toBeNull();
    expect(r.noVisual).toBe(false);
    expect(r.error).toBeNull();
    expect(errors(r.diagnostics)).toHaveLength(0);
  });

  it('`no-visual` suppresses the calendar band', () => {
    const r = parseCountdown(`countdown Trip\ntarget 2026-08-21\nno-visual`);
    expect(r.noVisual).toBe(true);
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

  it('parses an inline note', () => {
    const r = parseCountdown(
      `countdown X\ntarget 2026-08-21\nnote buy **flowers**`
    );
    expect(r.note).toBe('buy **flowers**');
    expect(errors(r.diagnostics)).toHaveLength(0);
  });

  it('parses a note block with indented body (no indent warning)', () => {
    const r = parseCountdown(
      `countdown X\ntarget 2026-08-21\nnote Agenda\n  - divide plunder\n  - grog`
    );
    expect(r.note).toBe('Agenda\n- divide plunder\n- grog');
    expect(r.diagnostics.some((d) => d.severity === 'warning')).toBe(false);
  });
});

describe('targetToMs', () => {
  it('treats a bare date as local midnight', () => {
    expect(targetToMs('2026-08-21')).toBe(new Date(2026, 7, 21).getTime());
  });
  it('returns null for garbage', () => {
    expect(targetToMs('nope')).toBeNull();
  });
  it('resolves a bare date in an explicit tz (NY midnight = 04:00Z EDT)', () => {
    expect(targetToMs('2026-08-21', 'America/New_York')).toBe(
      Date.parse('2026-08-21T04:00:00Z')
    );
  });
  it('resolves an offset-free datetime in tz (NY 18:00 EDT = 22:00Z)', () => {
    expect(targetToMs('2026-08-21T18:00', 'America/New_York')).toBe(
      Date.parse('2026-08-21T22:00:00Z')
    );
  });
  it('honors an explicit ISO offset regardless of tz', () => {
    expect(targetToMs('2026-08-21T18:00-04:00', 'Asia/Tokyo')).toBe(
      Date.parse('2026-08-21T22:00:00Z')
    );
  });
});

// ============================================================
// Parser — tz slot (§36 time-zone pinning)
// ============================================================

describe('countdown parser — tz', () => {
  it('parses a valid IANA zone onto `tz`', () => {
    const r = parseCountdown(
      `countdown Launch\ntarget 2026-08-21T18:00\ntz America/New_York`
    );
    expect(r.tz).toBe('America/New_York');
    // NY 18:00 EDT = 22:00Z — stable regardless of the machine's own clock.
    expect(r.resolvedMs).toBe(Date.parse('2026-08-21T22:00:00Z'));
    expect(errors(r.diagnostics)).toHaveLength(0);
  });

  it('accepts `tz` before `target` (order-independent)', () => {
    const r = parseCountdown(
      `countdown Launch\ntz America/New_York\ntarget 2026-08-21T18:00`
    );
    expect(r.tz).toBe('America/New_York');
    expect(r.resolvedMs).toBe(Date.parse('2026-08-21T22:00:00Z'));
  });

  it('warns and falls back to viewer-local on an unknown zone', () => {
    const r = parseCountdown(`countdown X\ntarget 2026-08-21\ntz Not/AZone`);
    expect(r.tz).toBeNull();
    expect(r.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
  });

  it('pins a recurring `at` time to the zone (Fri 09:00 IST = 03:30Z)', () => {
    const r = parseCountdown(
      `countdown Standup\nevery week on Friday at 09:00\ntz Asia/Kolkata`
    );
    expect(r.rule?.tz).toBe('Asia/Kolkata');
    // FIXED_NOW is Fri 2026-07-10 00:00Z; 09:00 IST that day = 03:30Z, still
    // ahead of now, so it's the next occurrence.
    const resolved = resolveNext(r.rule!, FIXED_NOW);
    expect(new Date(resolved).toISOString()).toBe('2026-07-10T03:30:00.000Z');
  });

  it('bakes tz onto the hero + footer so the ticker stays in-zone', () => {
    const r = parseCountdown(
      `countdown Launch\ntarget 2026-08-21T18:00\ntz America/New_York`
    );
    const c = makeContainer();
    renderCountdown(c, r, nordLight, false);
    const svg = c.querySelector('svg')!.outerHTML;
    expect(svg).toContain('data-dgmo-countdown-tz="America/New_York"');
    // Footer shows the NY wall-clock + an offset tag, not the viewer's time.
    expect(svg).toContain('18:00');
    expect(svg).toContain('UTC');
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
  it('words (no leading "in")', () => {
    expect(
      formatCount(6 * DAY, { units: 'words', round: 'up', fields: [] })
    ).toBe('6 days');
  });
});

describe('formatHuman — coarse hero + finer remainder', () => {
  const at = (iso: string): number => Date.parse(iso);
  it('years cross into the hero; months/days demote to the sub-line', () => {
    // 1 year, 2 months, 3 days out.
    const h = formatHuman(at('2026-05-15T00:00:00'), at('2027-07-18T00:00:00'));
    expect(h.big).toBe('1 year, 2 months');
    expect(h.sub).toBe('3 days');
  });
  it('drops leading zero units (no "0 years")', () => {
    // 2 months, 4 days.
    const h = formatHuman(at('2026-05-15T00:00:00'), at('2026-07-19T00:00:00'));
    expect(h.big).toBe('2 months, 4 days');
    expect(h.sub).toBe('');
  });
  it('sub-day delta reads in hours/minutes, no empty remainder', () => {
    const h = formatHuman(at('2026-05-15T09:00:00'), at('2026-05-15T14:30:00'));
    expect(h.big).toBe('5 hours, 30 minutes');
    expect(h.sub).toBe('');
  });
  it('a coarse-only span keeps a single hero unit', () => {
    // Exactly 3 months, no remainder.
    const h = formatHuman(at('2026-05-15T00:00:00'), at('2026-08-15T00:00:00'));
    expect(h.big).toBe('3 months');
    expect(h.sub).toBe('');
  });
});

// ============================================================
// Renderer — baked markers, footer, as-of stamp
// ============================================================

describe('countdown renderer — baked markers', () => {
  it('bakes a whole-day count + data-* attrs, footer, as-of stamp, no <script>', () => {
    const c = renderAt(
      `countdown Trip\ntarget 2026-08-21\nunits days`,
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

  it('since eyebrow: fills the Nth/N template', () => {
    const c = renderAt(
      `countdown Anniversary\nevery year on Jun 14\nsince 2019\nsince-label Nth Anniversary`,
      '2026-07-10T00:00:00Z'
    );
    // Next Jun 14 is 2027 → 2027 − 2019 = 8 → "8th Anniversary".
    const eyebrow = c.querySelector('[data-dgmo-countdown-eyebrow]');
    expect(eyebrow?.textContent).toBe('8th Anniversary');
  });

  it('since eyebrow: default template is "Nth <title>"', () => {
    const c = renderAt(
      `countdown Trip\nevery year on Jun 14\nsince 2019`,
      '2026-07-10T00:00:00Z'
    );
    const eyebrow = c.querySelector('[data-dgmo-countdown-eyebrow]');
    expect(eyebrow?.textContent).toBe('8th Trip');
  });
});

// ============================================================
// Renderer — human hero + calendar band tiers (§36.5–36.7)
// ============================================================

function allText(c: HTMLElement): string {
  return Array.from(c.querySelectorAll('text'))
    .map((t) => t.textContent ?? '')
    .join(' | ');
}
function svgHeight(c: HTMLElement): number {
  return Number(c.querySelector('svg')?.getAttribute('height') ?? 0);
}

describe('countdown renderer — human hero + band', () => {
  it('default human hero: coarse top-2 units, finer remainder in the sub-line', () => {
    // 2026-07-10 → 2027-09-13 = 1 year, 2 months, 3 days.
    const c = renderAt(
      `countdown Voyage\ntarget 2027-09-13`,
      '2026-07-10T00:00:00Z'
    );
    expect(valueNode(c).textContent).toBe('1 year, 2 months');
    expect(c.querySelector('[data-dgmo-countdown-detail]')?.textContent).toBe(
      '3 days'
    );
    expect(valueNode(c).getAttribute('data-dgmo-countdown-units')).toBe(
      'human'
    );
  });

  it('band is default-on; `no-visual` suppresses it (shorter banner)', () => {
    const withBand = renderAt(
      `countdown Voyage\ntarget 2027-09-13`,
      '2026-07-10T00:00:00Z'
    );
    const noBand = renderAt(
      `countdown Voyage\ntarget 2027-09-13\nno-visual`,
      '2026-07-10T00:00:00Z'
    );
    expect(svgHeight(withBand)).toBeGreaterThan(svgHeight(noBand));
  });

  it('> 1 year → year-blocks band (year labels)', () => {
    const c = renderAt(
      `countdown Voyage\ntarget 2028-08-21`,
      '2026-07-10T00:00:00Z'
    );
    expect(allText(c)).toContain('2026');
    expect(allText(c)).toContain('2028');
  });

  it('3–12 months → month rectangles (labels + only now/target dated, no day grid)', () => {
    // ~5 months out.
    const c = renderAt(
      `countdown Voyage\ntarget 2026-12-01`,
      '2026-07-12T00:00:00Z'
    );
    const tokens = allText(c).split(' | ');
    expect(tokens).toContain('Jul'); // month-rect label, no year
    expect(tokens).not.toContain('Jul 2026');
    // Month-rectangles date ONLY now/target — no mid-month day like 25.
    expect(tokens).not.toContain('25');
  });

  it('≤ ~3 months → dot calendars dating only now + target', () => {
    const c = renderAt(
      `countdown Voyage\ntarget 2026-09-01`,
      '2026-07-12T00:00:00Z'
    );
    const tokens = allText(c).split(' | ');
    expect(tokens).toContain('Jul 2026'); // centered month label with year
    expect(tokens).toContain('12'); // today is dated
    // Every other day is an unlabeled dot — no mid-month number.
    expect(tokens).not.toContain('25');
  });

  it('short span → stretchy day-strip today→event (TODAY tag; a cell per day)', () => {
    const c = renderAt(
      `countdown Voyage\ntarget 2026-07-14`,
      '2026-07-10T00:00:00Z'
    );
    const txt = allText(c);
    expect(txt).toContain('TODAY');
    // One cell per day from today (10) to the event (14, rightmost). The gradient
    // + halo carry progress, so there are no per-cell "Nd to go" tags.
    for (const d of ['10', '11', '12', '13', '14']) expect(txt).toContain(d);
    expect(txt).not.toContain('to go');
  });

  it('8+ day span → real day calendar, not the week strip', () => {
    const c = renderAt(
      `countdown Voyage\ntarget 2026-07-22`, // 12 days → monthgrid tier
      '2026-07-10T00:00:00Z'
    );
    const tokens = allText(c).split(' | ');
    expect(tokens).toContain('Jul 2026'); // centered month-calendar label
    expect(tokens).toContain('10'); // today is dated
    // The month calendar dots the between-days — no weekstrip TODAY tag.
    expect(allText(c)).not.toContain('TODAY');
  });

  it('timed final day → three H·M·S ring gauges + a clock hero', () => {
    const c = renderAt(
      `countdown Launch\ntarget 2026-07-10T18:00`,
      '2026-07-10T12:00:00Z'
    );
    expect(c.querySelectorAll('[data-dgmo-gauge-val]')).toHaveLength(3);
    expect(c.querySelector('[data-dgmo-gauge-caption]')?.textContent).toBe(
      'TO GO'
    );
    expect(valueNode(c).textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('timed past instant → rings count up, caption flips to AGO', () => {
    const c = renderAt(
      `countdown Launch\ntarget 2026-07-10T12:00`,
      '2026-07-10T13:00:00Z'
    );
    expect(c.querySelector('[data-dgmo-gauge-caption]')?.textContent).toBe(
      'AGO'
    );
    expect(valueNode(c).textContent).toContain('ago');
  });

  it('`expired` freezes a passed one-shot — no band, fixed message', () => {
    const c = renderAt(
      `countdown Gone\ntarget 2026-07-01T09:00\nexpired ⚓ Sailed`,
      '2026-07-10T00:00:00Z'
    );
    expect(valueNode(c).textContent).toBe('⚓ Sailed');
    expect(c.querySelectorAll('[data-dgmo-gauge-val]')).toHaveLength(0);
  });
});

describe('countdown — a passed target mirrors the ramp (opposite direction)', () => {
  it('all-day past hero reads a flat "N days ago" — no false hours', () => {
    const c = renderAt(
      `countdown Kraken\ntarget 2026-07-05`, // 7 days ago
      '2026-07-12T00:00:00Z'
    );
    expect(valueNode(c).textContent).toBe('7 days ago');
  });

  it('recently passed (≤ 7d) → the same week strip, event haloed', () => {
    const c = renderAt(
      `countdown Kraken\ntarget 2026-07-08`, // 4 days ago
      '2026-07-12T00:00:00Z'
    );
    const txt = allText(c);
    expect(txt).toContain('TODAY'); // the strip's today tag
    for (const d of ['8', '12']) expect(txt).toContain(d); // event(8)…today(12)
    // The event still gets the target halo — same anchor styling as a future run.
    expect(c.querySelector('.dgmo-countdown-target-ring')).toBeTruthy();
  });

  it('8+ days passed → the same day-calendar tier (no bespoke afterglow)', () => {
    const c = renderAt(
      `countdown Kraken\ntarget 2026-06-28`, // 14 days ago
      '2026-07-12T00:00:00Z'
    );
    const tokens = allText(c).split(' | ');
    expect(tokens).toContain('Jun 2026'); // real month-calendar labels
    expect(tokens).toContain('Jul 2026');
    expect(valueNode(c).textContent).toBe('14 days ago');
    expect(c.querySelector('.dgmo-countdown-target-ring')).toBeTruthy();
  });
});

// ============================================================
// Ticker — live update, roll-forward, stamp erasure
// ============================================================

describe('countdown ticker', () => {
  it('days mode: rewrites textContent + aria-label from the absolute target', () => {
    const c = renderAt(
      `countdown Trip\ntarget 2026-08-21\nunits days`,
      '2026-07-10T00:00:00Z'
    );
    vi.setSystemTime(Date.parse('2026-08-01T00:00:00Z'));
    tickCountdowns(c);
    expect(valueNode(c).textContent).toBe('20 days');
    expect(valueNode(c).getAttribute('aria-label')).toContain('Trip');
  });

  it('all-day past: ticks a flat "N days ago" even mid-day (no false hours)', () => {
    const c = renderAt(
      `countdown Kraken\ntarget 2026-07-20`,
      '2026-07-10T00:00:00Z'
    );
    vi.setSystemTime(Date.parse('2026-07-27T08:30:00Z')); // 7 days + 8½h later
    tickCountdowns(c);
    expect(valueNode(c).textContent).toBe('7 days ago');
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

  it('all-day recurring ON its day → on-day text, not "next year"', () => {
    // The critical fix: an all-day occurrence stays current for its whole day.
    const c = renderAt(
      `countdown Birthday\nevery year on Jul 12\non-day 🎂 Today!`,
      '2026-07-12T12:00:00Z' // Jul 12 IS the day
    );
    expect(valueNode(c).textContent).toBe('🎂 Today!');
  });

  it('since eyebrow re-applies the template live on a roll-forward tick', () => {
    const c = renderAt(
      `countdown Anniversary\nevery year on Jul 12\nsince 2019\nsince-label Nth Anniversary`,
      '2026-07-11T00:00:00Z'
    );
    // Jul 12 2026 → 7th. After it passes, rolls to Jul 12 2027 → 8th.
    expect(c.querySelector('[data-dgmo-countdown-eyebrow]')?.textContent).toBe(
      '7th Anniversary'
    );
    vi.setSystemTime(Date.parse('2026-07-13T00:00:00Z'));
    tickCountdowns(c);
    expect(c.querySelector('[data-dgmo-countdown-eyebrow]')?.textContent).toBe(
      '8th Anniversary'
    );
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

  it('human mode: recomputes the coarse hero + finer sub-line each tick', () => {
    const c = renderAt(
      `countdown Voyage\ntarget 2027-09-13`,
      '2026-07-10T00:00:00Z'
    );
    vi.setSystemTime(Date.parse('2026-08-01T00:00:00Z'));
    tickCountdowns(c);
    // 2026-08-01 → 2027-09-13 = 1 year, 1 month, 12 days.
    expect(valueNode(c).textContent).toBe('1 year, 1 month');
    expect(c.querySelector('[data-dgmo-countdown-detail]')?.textContent).toBe(
      '12 days'
    );
  });

  it('timed finale: ring gauges + clock hero recompute; caption flips at the pivot', () => {
    const c = renderAt(
      `countdown Launch\ntarget 2026-07-10T18:00`,
      '2026-07-10T12:00:00Z'
    );
    // 3 h before → 03:00:00, TO GO.
    vi.setSystemTime(Date.parse('2026-07-10T15:00:00Z'));
    tickCountdowns(c);
    expect(valueNode(c).textContent).toBe('03:00:00');
    expect(c.querySelector('[data-dgmo-gauge-val="h"]')?.textContent).toBe(
      '03'
    );
    expect(c.querySelector('[data-dgmo-gauge-caption]')?.textContent).toBe(
      'TO GO'
    );
    // 30 min after → counts up, AGO.
    vi.setSystemTime(Date.parse('2026-07-10T18:30:00Z'));
    tickCountdowns(c);
    expect(valueNode(c).textContent).toBe('00:30:00 ago');
    expect(c.querySelector('[data-dgmo-gauge-caption]')?.textContent).toBe(
      'AGO'
    );
  });
});

// ============================================================
// Subordinate seconds — split HH:MM:SS so the fast seconds ride smaller/blue
// and tabular-nums keeps the right-anchored clock from staggering per tick.
// ============================================================

describe('splitClockSeconds', () => {
  it('splits a full clock into lead + :SS', () => {
    expect(splitClockSeconds('06:29:20')).toEqual({
      lead: '06:29',
      sec: ':20',
    });
    expect(splitClockSeconds('3d 06:14:03')).toEqual({
      lead: '3d 06:14',
      sec: ':03',
    });
  });
  it('leaves non-clock / seconds-pruned strings whole', () => {
    expect(splitClockSeconds('1 year, 2 months')).toEqual({
      lead: '1 year, 2 months',
      sec: null,
    });
    expect(splitClockSeconds('06:29')).toEqual({ lead: '06:29', sec: null });
    expect(splitClockSeconds('20 days')).toEqual({
      lead: '20 days',
      sec: null,
    });
  });
});

describe('countdown seconds — subordinate rendering', () => {
  it('bakes a smaller cold-blue seconds tspan + tabular-nums on the clock finale hero', () => {
    const c = renderAt(
      `countdown Launch\ntarget 2026-07-10T18:00\nunits clock`,
      '2026-07-10T15:00:00Z' // 03:00:00 to go — clock finale
    );
    const hero = valueNode(c);
    expect(hero.getAttribute('font-variant-numeric')).toBe('tabular-nums');
    expect(hero.querySelector('[data-cd-lead]')?.textContent).toBe('03:00');
    const sec = hero.querySelector('[data-cd-sec]') as Element;
    expect(sec.textContent).toBe(':00');
    // seconds render smaller than the hero font and in the `now` blue.
    expect(Number(sec.getAttribute('font-size'))).toBeLessThan(
      Number(hero.getAttribute('font-size'))
    );
    expect(sec.getAttribute('fill')).toBe(
      hero.getAttribute('data-dgmo-cd-sec-fill')
    );
  });

  it('a non-clock (human) hero has no seconds tspan', () => {
    const c = renderAt(
      `countdown Voyage\ntarget 2027-09-13`,
      '2026-07-10T00:00:00Z'
    );
    expect(valueNode(c).querySelector('[data-cd-sec]')).toBeNull();
  });

  it('the live ticker splits the seconds when full mode upgrades to Nd HH:MM:SS', () => {
    const c = renderAt(
      `countdown Launch\ntarget 2026-08-21T00:00:00Z\nunits full`,
      '2026-07-10T00:00:00Z'
    );
    vi.setSystemTime(Date.parse('2026-08-17T17:45:57Z'));
    tickCountdowns(c);
    const hero = valueNode(c);
    expect(hero.textContent).toBe('3d 06:14:03'); // concatenated tspans
    expect(hero.querySelector('[data-cd-lead]')?.textContent).toBe('3d 06:14');
    expect(hero.querySelector('[data-cd-sec]')?.textContent).toBe(':03');
  });

  it('the detail sub-line splits its ticking clock (human hero, timed target days out)', () => {
    const c = renderAt(
      `countdown Launch\ntarget 2026-07-20T18:00`,
      '2026-07-10T12:00:00Z'
    );
    vi.setSystemTime(Date.parse('2026-07-15T12:34:56Z'));
    tickCountdowns(c);
    const detail = c.querySelector('[data-dgmo-countdown-detail]') as Element;
    expect(detail.textContent).toContain(':'); // a HH:MM:SS clock
    expect(detail.querySelector('[data-cd-sec]')).not.toBeNull();
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

// ============================================================
// Parser — liberal date input (BL-121)
// ============================================================

describe('countdown parser — liberal date input', () => {
  it('accepts a month-name target and normalizes to ISO', () => {
    const r = parseCountdown(`countdown Launch\ntarget July 4, 2026`);
    expect(r.target).toBe('2026-07-04');
    expect(errors(r.diagnostics)).toHaveLength(0);
  });

  it('accepts a US slash target (month-first default)', () => {
    const r = parseCountdown(`countdown Launch\ntarget 8/21/2026`);
    expect(r.target).toBe('2026-08-21');
    expect(errors(r.diagnostics)).toHaveLength(0);
  });

  it('`year` directive supplies the year for a bare month-day', () => {
    const r = parseCountdown(`countdown Launch\nyear 2026\ntarget 8/21`);
    expect(r.target).toBe('2026-08-21');
    expect(errors(r.diagnostics)).toHaveLength(0);
  });

  it('`date-order dmy` reads the slash target day-first', () => {
    const r = parseCountdown(
      `countdown Launch\ndate-order dmy\ntarget 21/8/2026`
    );
    expect(r.target).toBe('2026-08-21');
    expect(errors(r.diagnostics)).toHaveLength(0);
  });

  it('out-of-range slash self-disambiguates regardless of order', () => {
    const r = parseCountdown(`countdown Launch\ntarget 13/2/2026`);
    expect(r.target).toBe('2026-02-13');
    expect(errors(r.diagnostics)).toHaveLength(0);
  });

  it('an explicit-offset ISO target passes through untouched (absolute instant)', () => {
    const r = parseCountdown(`countdown Launch\ntarget 2026-08-21T18:00-04:00`);
    expect(r.target).toBe('2026-08-21T18:00-04:00');
    expect(errors(r.diagnostics)).toHaveLength(0);
  });

  it('still accepts `now`', () => {
    const r = parseCountdown(`countdown Launch\ntarget now`);
    expect(r.error).toBeNull();
    expect(errors(r.diagnostics)).toHaveLength(0);
  });
});

// ============================================================
// §1.9 fill family (fill-tint / fill-solid / fill-outline) — §36.6
// ============================================================

describe('countdown parser — §1.9 fill family', () => {
  it('defaults to no fillMode; parses solid/outline; last one wins; fill-tint resets', () => {
    const base = 'countdown T\ntarget 2026-08-21';
    expect(parseCountdown(base).fillMode).toBeUndefined();
    expect(parseCountdown(`${base}\nfill-solid`).fillMode).toBe('solid');
    expect(parseCountdown(`${base}\nfill-outline`).fillMode).toBe('outline');
    expect(parseCountdown(`${base}\nfill-solid\nfill-outline`).fillMode).toBe(
      'outline'
    );
    expect(
      parseCountdown(`${base}\nfill-outline\nfill-tint`).fillMode
    ).toBeUndefined();
  });

  it('the tokens are recognized directives (no "Unrecognized line" warning)', () => {
    const r = parseCountdown('countdown T\ntarget 2026-08-21\nfill-outline');
    expect(r.diagnostics).toHaveLength(0);
  });
});

describe('countdown renderer — §1.9 fill family', () => {
  const baseBg = themeBaseBg(nordLight, false);
  const red = nordLight.colors.red!; // the default accent = the event chip
  const blue = nordLight.colors.blue!; // the fixed `now` anchor
  const NOW = '2026-07-10T00:00:00Z';
  const SRC = 'countdown Launch\ntarget 2026-07-16'; // 6 days → weekstrip tier

  const rects = (c: HTMLElement): Element[] =>
    Array.from(c.querySelectorAll('rect'));

  it('fill-outline: anchor chips fill with the base bg, color moves to the stroke', () => {
    const c = renderAt(`${SRC}\nfill-outline`, NOW);
    expect(
      rects(c).some(
        (r) =>
          r.getAttribute('fill') === baseBg && r.getAttribute('stroke') === red
      )
    ).toBe(true); // the event chip
    expect(
      rects(c).some(
        (r) =>
          r.getAttribute('fill') === baseBg && r.getAttribute('stroke') === blue
      )
    ).toBe(true); // the today chip
    // Cell text takes the chip color (readable on the empty fill).
    const todayTag = Array.from(c.querySelectorAll('text')).find(
      (t) => t.textContent === 'TODAY'
    )!;
    expect(todayTag.getAttribute('fill')).toBe(blue);
  });

  it('fill-outline: the inert gray padding cells stay gray', () => {
    // 3-day span → weekstrip pads with context cells on either side.
    const c = renderAt('countdown Gig\ntarget 2026-07-13\nfill-outline', NOW);
    const inert = mix(nordLight.text, nordLight.bg, 7);
    expect(rects(c).some((r) => r.getAttribute('fill') === inert)).toBe(true);
  });

  it('fill-solid: chips stay full-saturation with contrast-aware text', () => {
    const c = renderAt(`${SRC}\nfill-solid`, NOW);
    const evChip = rects(c).find(
      (r) => r.getAttribute('fill') === red && r.getAttribute('stroke') === red
    );
    expect(evChip).toBeTruthy();
    const ink = contrastText(
      red,
      nordLight.textOnFillLight,
      nordLight.textOnFillDark
    );
    expect(
      Array.from(c.querySelectorAll('text')).some(
        (t) => t.getAttribute('fill') === ink
      )
    ).toBe(true);
  });

  it('default (no token) keeps the legacy saturated chips (byte-identical)', () => {
    const c = renderAt(SRC, NOW);
    // No outline-style chip exists: nothing fills base-bg with a colored stroke.
    expect(
      rects(c).some(
        (r) =>
          r.getAttribute('fill') === baseBg &&
          (r.getAttribute('stroke') === red ||
            r.getAttribute('stroke') === blue)
      )
    ).toBe(false);
    expect(
      rects(c).some(
        (r) =>
          r.getAttribute('fill') === red && r.getAttribute('stroke') === red
      )
    ).toBe(true);
  });

  it('final-day ring gauges are meters — saturated in every fill mode', () => {
    for (const tok of ['fill-outline', 'fill-solid']) {
      const c = renderAt(
        `countdown Gig\ntarget 2026-07-10T18:00:00\n${tok}`,
        '2026-07-10T15:00:00Z'
      );
      const arc = c.querySelector('[data-dgmo-gauge-arc="h"]')!;
      expect(arc.getAttribute('stroke')).toBe(red);
    }
  });
});
