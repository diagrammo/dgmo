import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseClock } from '../src/clock/parser';
import { renderClock } from '../src/clock/renderer';
import { tickClocks } from '../src/clock/ticker';
import {
  zoneParts,
  fixedParts,
  parseFixedOffset,
  formatOffsetLabel,
  formatTime,
  handAngles,
  workStatus,
  sunLine,
  type WorkSpec,
} from '../src/clock/resolve';
import { resolvePlace, searchZones } from '../src/clock/gazetteer';
import { coordsFor } from '../src/clock/zone-coords';
import { getPalette } from '../src/palettes';
import { contrastText, themeBaseBg } from '../src/palettes/color-utils';
import { getRenderCategory } from '../src/dgmo-router';

// Determinism: the suite assumes TZ=UTC (set by the package test script / CI).
// A summer instant so DST offsets (BST / EDT) are stable and known.
const FIXED_ISO = '2026-07-10T15:30:07Z'; // a Friday, 15:30:07 UTC

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
  Object.defineProperty(c, 'clientHeight', { value: 400 });
  return c as HTMLDivElement;
}

function errors(diagnostics: readonly { severity: string }[]): unknown[] {
  return diagnostics.filter((d) => d.severity === 'error');
}
function warnings(diagnostics: readonly { severity: string }[]): unknown[] {
  return diagnostics.filter((d) => d.severity === 'warning');
}

function renderAt(source: string, iso: string): HTMLDivElement {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(iso));
  const container = makeContainer();
  const parsed = parseClock(source);
  renderClock(container, parsed, nordLight, false, { width: 800, height: 400 });
  return container;
}

// ============================================================
// Parser — anchor grammar (city | IANA | UTC offset)
// ============================================================

describe('clock parser', () => {
  it('parses title + a single IANA entry with defaults', () => {
    const r = parseClock(`clock Dani\nAmerica/New_York`);
    expect(r.type).toBe('clock');
    expect(r.title).toBe('Dani');
    expect(r.face).toBe('digital');
    expect(r.hours12).toBe(true);
    expect(r.sun).toBe(true);
    expect(r.work).toBeNull();
    expect(r.entries).toHaveLength(1);
    const e = r.entries[0]!;
    expect(e.kind).toBe('iana');
    expect(e.place).toBe('New York');
    expect(e.zone).toBe('America/New_York');
    expect(e.label).toBe('New York');
    expect(e.fixedOffsetMin).toBeNull();
    expect(r.error).toBeNull();
    expect(errors(r.diagnostics)).toHaveLength(0);
  });

  it('resolves a bare city name through the gazetteer', () => {
    const r = parseClock(`clock T\nLondon`);
    const e = r.entries[0]!;
    expect(e.kind).toBe('iana');
    expect(e.zone).toBe('Europe/London');
    expect(e.place).toBe('London');
    expect(e.lat).toBeCloseTo(51.51, 1);
    expect(warnings(r.diagnostics)).toHaveLength(0);
  });

  it('resolves a colloquial alias (NYC → America/New_York, canonical city)', () => {
    const r = parseClock(`clock T\nNYC as Dani`);
    const e = r.entries[0]!;
    expect(e.zone).toBe('America/New_York');
    expect(e.place).toBe('New York');
    expect(e.label).toBe('Dani');
  });

  it('resolves a historic alias (Bombay → Asia/Kolkata)', () => {
    const e = parseClock(`clock T\nBombay`).entries[0]!;
    expect(e.zone).toBe('Asia/Kolkata');
    expect(e.place).toBe('Kolkata');
  });

  it('honors the `as <label>` alias and multi-word city names', () => {
    const e = parseClock(`clock Crew\nLos Angeles as West coast`).entries[0]!;
    expect(e.place).toBe('Los Angeles');
    expect(e.zone).toBe('America/Los_Angeles');
    expect(e.label).toBe('West coast');
  });

  it('accepts a raw UTC offset as a fixed, no-DST row', () => {
    const e = parseClock(`clock T\nUTC+5:30 as Bangalore ops`).entries[0]!;
    expect(e.kind).toBe('fixed');
    expect(e.fixedOffsetMin).toBe(330);
    expect(e.zone).toBe('UTC+5:30');
    expect(e.place).toBe('UTC+5:30');
    expect(e.label).toBe('Bangalore ops');
    expect(e.lat).toBeNull();
  });

  it('accepts bare UTC (and GMT) as +00:00', () => {
    const utc = parseClock(`clock T\nUTC as Servers`).entries[0]!;
    expect(utc.kind).toBe('fixed');
    expect(utc.fixedOffsetMin).toBe(0);
    expect(utc.zone).toBe('UTC');
    expect(utc.label).toBe('Servers');
    const gmt = parseClock(`clock T\nGMT-3`).entries[0]!;
    expect(gmt.kind).toBe('fixed');
    expect(gmt.fixedOffsetMin).toBe(-180);
    expect(gmt.zone).toBe('UTC-3');
  });

  it('parses flat board flags (analog/no-sun/time-24) + work window', () => {
    const r = parseClock(
      `clock Team\nanalog\nhours 9-17\ndays mon-fri\nno-sun\ntime-24\nBerlin`
    );
    expect(r.face).toBe('analog');
    expect(r.hours12).toBe(false);
    expect(r.sun).toBe(false);
    expect(r.work).not.toBeNull();
    expect(r.work!.startMin).toBe(540);
    expect(r.work!.endMin).toBe(1020);
    expect(r.work!.days).toEqual({
      Mon: true,
      Tue: true,
      Wed: true,
      Thu: true,
      Fri: true,
    });
  });

  it('parses hours as 24h, am/pm, and smart-bare PM', () => {
    const win = (s: string) => parseClock(`clock T\nhours ${s}\nLondon`).work;
    expect(win('9-17')).toMatchObject({ startMin: 540, endMin: 1020 });
    expect(win('9-5')).toMatchObject({ startMin: 540, endMin: 1020 }); // bare→PM
    expect(win('9am-5pm')).toMatchObject({ startMin: 540, endMin: 1020 });
    expect(win('8:30-5:15')).toMatchObject({ startMin: 510, endMin: 1035 });
    expect(win('8:30am-5:15pm')).toMatchObject({ startMin: 510, endMin: 1035 });
    expect(win('12pm-9pm')).toMatchObject({ startMin: 720, endMin: 1260 });
    expect(win('6-8')).toMatchObject({ startMin: 360, endMin: 480 }); // fwd→literal
  });

  it('reads a trailing palette color per row (swimlane tint)', () => {
    const r = parseClock(
      `clock T\nLos Angeles as Paul blue\nNew York as Greg`,
      nordLight
    );
    expect(r.entries[0]!.label).toBe('Paul');
    expect(r.entries[0]!.color).not.toBeNull();
    expect(r.entries[1]!.color).toBeNull();
  });

  it('reads a trailing color on a bare anchor (no alias)', () => {
    const e = parseClock(`clock T\nLondon blue`, nordLight).entries[0]!;
    expect(e.zone).toBe('Europe/London');
    expect(e.color).not.toBeNull();
    expect(e.label).toBe('London');
  });

  it('reads `direction lr` as a columns layout', () => {
    expect(parseClock(`clock T\nNew York`).columns).toBe(false);
    expect(parseClock(`clock T\ndirection lr\nNew York`).columns).toBe(true);
    expect(parseClock(`clock T\ndirection tb\nNew York`).columns).toBe(false);
    // Exact-match values only — junk like `lrx` does not select columns.
    expect(parseClock(`clock T\ndirection lrx\nNew York`).columns).toBe(false);
  });

  it('reads the direction booleans (canonical, decision #48); last one wins', () => {
    expect(parseClock(`clock T\ndirection-lr\nNew York`).columns).toBe(true);
    expect(parseClock(`clock T\ndirection-tb\nNew York`).columns).toBe(false);
    expect(
      parseClock(`clock T\ndirection-lr\ndirection-tb\nNew York`).columns
    ).toBe(false);
    expect(
      parseClock(`clock T\ndirection-tb\ndirection-lr\nNew York`).columns
    ).toBe(true);
  });

  it('direction booleans are directives, never timezone entries', () => {
    const p = parseClock(`clock T\ndirection-lr\ndirection-tb\nNew York`);
    expect(p.entries).toHaveLength(1);
    expect(p.entries[0]!.zone).toBe('America/New_York');
    expect(p.diagnostics).toHaveLength(0);
  });

  it('renders one column group per entry in columns mode', () => {
    const c = renderAt(
      `clock T\ndirection lr\nLA as West\nNYC as East`,
      FIXED_ISO
    );
    expect(c.querySelectorAll('[data-dgmo-clock]')).toHaveLength(2);
    expect(
      c.querySelector('[data-dgmo-clock-digital-part="main"]')
    ).not.toBeNull();
  });

  it('is order-independent and tolerant of blank lines / comments', () => {
    const r = parseClock(
      `clock Board\n\nAmerica/New_York\n# a comment\nhours 8-16\nLondon\n`
    );
    expect(r.entries).toHaveLength(2);
    expect(r.work!.startMin).toBe(480);
  });

  it('supports a comma list for days', () => {
    const r = parseClock(`clock T\nhours 9-17\ndays mon,wed,fri\nUTC`);
    expect(r.work!.days).toEqual({ Mon: true, Wed: true, Fri: true });
  });

  it('parses canonical `workweek` as a directive, not a zone row (decision #48)', () => {
    const r = parseClock(`clock T\nhours 9-17\nworkweek mon-fri\nLondon`);
    expect(r.entries).toHaveLength(1); // London only — workweek is not an entry
    expect(r.work!.days).toEqual({
      Mon: true,
      Tue: true,
      Wed: true,
      Thu: true,
      Fri: true,
    });
  });

  it('`workweek` matches the legacy `days` alias exactly', () => {
    const canonical = parseClock(`clock T\nhours 9-17\nworkweek mon,wed\nUTC`);
    const legacy = parseClock(`clock T\nhours 9-17\ndays mon,wed\nUTC`);
    expect(canonical.work).toEqual(legacy.work);
  });

  it('skips an unknown IANA zone and warns', () => {
    const r = parseClock(`clock T\nMars/Phobos\nLondon`);
    expect(r.entries).toHaveLength(1); // only the valid row survives
    expect(r.entries[0]!.zone).toBe('Europe/London');
    expect(warnings(r.diagnostics).length).toBeGreaterThan(0);
  });

  it('skips an unknown place and warns with a did-you-mean when close', () => {
    const r = parseClock(`clock T\nLundon\nTokyo`);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.zone).toBe('Asia/Tokyo');
    const w = warnings(r.diagnostics);
    expect(w.length).toBeGreaterThan(0);
    expect((w[0] as { message: string }).message).toMatch(/London/);
  });

  it('errors on an ambiguous place, listing the candidates', () => {
    const r = parseClock(`clock T\nSan Jose\nLondon`);
    // Ambiguous row dropped; the valid row survives.
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.zone).toBe('Europe/London');
    const errs = errors(r.diagnostics);
    expect(errs.length).toBeGreaterThan(0);
    expect((errs[0] as { message: string }).message).toMatch(
      /America\/Los_Angeles/
    );
  });

  it('warns when `days` is given without `hours` (no work window)', () => {
    const r = parseClock(`clock T\ndays mon-fri\nLondon`);
    expect(r.work).toBeNull();
    expect(warnings(r.diagnostics).length).toBeGreaterThan(0);
  });

  it('warns when `workweek` is given without `hours` (still no bogus entry)', () => {
    const r = parseClock(`clock T\nworkweek mon-fri\nLondon`);
    expect(r.work).toBeNull();
    expect(r.entries).toHaveLength(1); // the bare directive never becomes a zone row
    expect(warnings(r.diagnostics).length).toBeGreaterThan(0);
  });

  it('errors on a bad first line and on a bodyless clock', () => {
    expect(parseClock(`flowchart X\nA -> B`).error).not.toBeNull();
    const empty = parseClock(`clock Nobody`);
    expect(errors(empty.diagnostics).length).toBeGreaterThan(0);
  });

  it('is registered as a visualization', () => {
    expect(getRenderCategory('clock')).toBe('visualization');
  });
});

// ============================================================
// Gazetteer
// ============================================================

describe('clock gazetteer', () => {
  it('resolves exact cities, aliases, and reports unknowns', () => {
    expect(resolvePlace('London')).toMatchObject({
      kind: 'ok',
      zone: 'Europe/London',
    });
    expect(resolvePlace('nyc')).toMatchObject({
      kind: 'ok',
      zone: 'America/New_York',
    });
    expect(resolvePlace('Bombay')).toMatchObject({
      kind: 'ok',
      zone: 'Asia/Kolkata',
    });
    expect(resolvePlace('Atlantis').kind).toBe('unknown');
  });

  it('flags an ambiguous name with all candidates', () => {
    const r = resolvePlace('San Jose');
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') {
      const zones = r.candidates.map((c) => c.zone);
      expect(zones).toContain('America/Los_Angeles');
      expect(zones).toContain('America/Costa_Rica');
    }
  });

  it('suggests a near-miss via edit distance', () => {
    const r = resolvePlace('Lundon');
    expect(r.kind).toBe('unknown');
    if (r.kind === 'unknown') expect(r.suggestion).toBe('London');
  });

  it('searchZones ranks a prefix match first with a live offset', () => {
    const ms = Date.parse(FIXED_ISO);
    const hits = searchZones('Lon', ms);
    expect(hits[0]!.city).toBe('London');
    expect(hits[0]!.zone).toBe('Europe/London');
    expect(hits[0]!.offsetLabel).toBe('UTC+1'); // BST in July
    // Also finds the disambiguated London, ON alias somewhere in the list.
    expect(hits.some((h) => h.zone === 'America/Toronto')).toBe(true);
  });

  it('searchZones matches raw IANA text', () => {
    const ms = Date.parse(FIXED_ISO);
    const hits = searchZones('asia/tok', ms);
    expect(hits.some((h) => h.zone === 'Asia/Tokyo')).toBe(true);
  });
});

// ============================================================
// resolve.ts — shared math
// ============================================================

describe('clock resolve — zoneParts', () => {
  it('reads zone-local hour/minute/second + offset (summer DST)', () => {
    const ms = Date.parse(FIXED_ISO);
    const ny = zoneParts('America/New_York', ms);
    expect(ny.h).toBe(11); // 15:30 UTC − 4 = 11:30 EDT
    expect(ny.m).toBe(30);
    expect(ny.s).toBe(7);
    expect(ny.weekday).toBe('Fri');
    expect(ny.offsetLabel).toBe('UTC-4');

    const london = zoneParts('Europe/London', ms);
    expect(london.h).toBe(16); // 15:30 UTC + 1 = 16:30 BST
    expect(london.offsetLabel).toBe('UTC+1');
  });

  it('falls back to UTC parts for an invalid zone', () => {
    const ms = Date.parse(FIXED_ISO);
    const p = zoneParts('Mars/Phobos', ms);
    expect(p.h).toBe(15);
    expect(p.m).toBe(30);
    expect(p.weekday).toBe('Fri');
  });
});

describe('clock resolve — fixed offsets', () => {
  it('parseFixedOffset accepts UTC/GMT forms and rejects the rest', () => {
    expect(parseFixedOffset('UTC')).toBe(0);
    expect(parseFixedOffset('GMT')).toBe(0);
    expect(parseFixedOffset('UTC+1')).toBe(60);
    expect(parseFixedOffset('UTC-7')).toBe(-420);
    expect(parseFixedOffset('UTC+5:30')).toBe(330);
    expect(parseFixedOffset('UTC+0530')).toBe(330);
    expect(parseFixedOffset('GMT+2')).toBe(120);
    expect(parseFixedOffset('UTC+14')).toBe(840);
    expect(parseFixedOffset('UTC+15')).toBeNull(); // out of range
    expect(parseFixedOffset('UTC-13')).toBeNull();
    expect(parseFixedOffset('Europe/London')).toBeNull();
    expect(parseFixedOffset('London')).toBeNull();
  });

  it('formatOffsetLabel round-trips the canonical label', () => {
    expect(formatOffsetLabel(0)).toBe('UTC');
    expect(formatOffsetLabel(60)).toBe('UTC+1');
    expect(formatOffsetLabel(-420)).toBe('UTC-7');
    expect(formatOffsetLabel(330)).toBe('UTC+5:30');
  });

  it('fixedParts is DST-blind: UTC + offset, straight', () => {
    const ms = Date.parse(FIXED_ISO); // 15:30:07 UTC Fri
    const p = fixedParts(330, ms); // +5:30
    expect(p.h).toBe(21);
    expect(p.m).toBe(0);
    expect(p.s).toBe(7);
    expect(p.weekday).toBe('Fri');
    expect(p.offsetLabel).toBe('UTC+5:30');
    const w = fixedParts(-420, ms); // −7 → 08:30:07
    expect(w.h).toBe(8);
    expect(w.offsetLabel).toBe('UTC-7');
  });
});

describe('clock resolve — formatTime', () => {
  it('formats 12-hour am/pm', () => {
    expect(formatTime(11, 30, 7, true)).toEqual({
      main: '11:30',
      sec: '07',
      ap: 'am',
    });
    expect(formatTime(13, 5, 9, true)).toEqual({
      main: '1:05',
      sec: '09',
      ap: 'pm',
    });
    expect(formatTime(0, 0, 0, true)).toEqual({
      main: '12:00',
      sec: '00',
      ap: 'am',
    });
  });
  it('formats 24-hour with no am/pm', () => {
    expect(formatTime(13, 5, 9, false)).toEqual({
      main: '13:05',
      sec: '09',
      ap: '',
    });
  });
});

describe('clock resolve — handAngles', () => {
  it('computes sweeping hand angles', () => {
    expect(handAngles(3, 0, 0)).toEqual({ hour: 90, minute: 0, second: 0 });
    expect(handAngles(6, 30, 0)).toEqual({
      hour: 195,
      minute: 180,
      second: 0,
    });
    expect(handAngles(0, 0, 30)).toEqual({ hour: 0, minute: 3, second: 180 });
  });
});

describe('clock resolve — workStatus', () => {
  const work: WorkSpec = {
    startMin: 540,
    endMin: 1020,
    days: { Mon: true, Tue: true, Wed: true, Thu: true, Fri: true },
  };
  it('returns null when no window', () => {
    expect(workStatus({ h: 10, m: 0, weekday: 'Mon' }, null)).toBeNull();
  });
  it('green while inside the window', () => {
    const s = workStatus({ h: 11, m: 30, weekday: 'Fri' }, work)!;
    expect(s.cls).toBe('ok');
    expect(s.text).toBe('5h 30m left');
  });
  it('soon within an hour of opening', () => {
    const s = workStatus({ h: 8, m: 40, weekday: 'Mon' }, work)!;
    expect(s.cls).toBe('soon');
    expect(s.text).toBe('starts in 20m');
  });
  it('off before the window (more than an hour out)', () => {
    const s = workStatus({ h: 6, m: 0, weekday: 'Mon' }, work)!;
    expect(s.cls).toBe('off');
    expect(s.text).toBe('starts in 3h 0m');
  });
  it('off after the window', () => {
    const s = workStatus({ h: 20, m: 10, weekday: 'Mon' }, work)!;
    expect(s.cls).toBe('off');
    expect(s.text).toBe('ended 3h 10m ago');
  });
  it('Weekend on a non-working day', () => {
    const s = workStatus({ h: 12, m: 0, weekday: 'Sun' }, work)!;
    expect(s.cls).toBe('off');
    expect(s.text).toBe('Weekend');
  });
});

describe('clock resolve — sunLine', () => {
  const ldn = coordsFor('Europe/London')!;
  it('sun up during the day (sunset in …)', () => {
    const s = sunLine(Date.parse('2026-07-10T15:30:00Z'), ldn.lat, ldn.lon);
    expect(s.up).toBe(true);
    expect(s.text).toMatch(/^sunset in /);
  });
  it('sun down before dawn (sunrise in …)', () => {
    const s = sunLine(Date.parse('2026-07-10T02:00:00Z'), ldn.lat, ldn.lon);
    expect(s.up).toBe(false);
    expect(s.text).toMatch(/sunrise/);
  });
});

// ============================================================
// Renderer — baked anchors
// ============================================================

describe('clock renderer — baked anchors', () => {
  it('bakes per-row clock anchors (analog + work + sun)', () => {
    const c = renderAt(
      `clock Crew\nanalog\nhours 9-17\ndays mon-fri\nLondon as UK`,
      FIXED_ISO
    );
    const row = c.querySelector('[data-dgmo-clock]')!;
    expect(row).not.toBeNull();
    expect(row.getAttribute('data-dgmo-clock-zone')).toBe('Europe/London');
    expect(row.getAttribute('data-dgmo-clock-face')).toBe('analog');
    expect(row.getAttribute('data-dgmo-clock-hours12')).toBe('1');
    expect(row.getAttribute('data-dgmo-clock-sun')).toBe('1');
    expect(row.getAttribute('data-dgmo-clock-work-start')).toBe('540');
    expect(row.getAttribute('data-dgmo-clock-work-end')).toBe('1020');
    expect(row.getAttribute('data-dgmo-clock-work-days')).toBe(
      'Mon,Tue,Wed,Thu,Fri'
    );
    expect(row.getAttribute('data-dgmo-clock-lat')).not.toBeNull();
    expect(row.querySelector('[data-dgmo-clock-hand="h"]')).not.toBeNull();
    expect(row.querySelector('[data-dgmo-clock-hand="m"]')).not.toBeNull();
    expect(row.querySelector('[data-dgmo-clock-hand="s"]')).not.toBeNull();
    expect(row.querySelector('[data-dgmo-clock-facebg]')).not.toBeNull();
    expect(row.querySelector('[data-dgmo-clock-status]')).not.toBeNull();
    expect(row.querySelector('[data-dgmo-clock-sun-line]')).not.toBeNull();
    const hand = row.querySelector('[data-dgmo-clock-hand="h"]')!;
    expect(hand.getAttribute('transform')).toMatch(/rotate\(/);
  });

  it('bakes a digital readout (main + dim seconds) in digital face', () => {
    const c = renderAt(`clock Mum\nLondon`, FIXED_ISO);
    const row = c.querySelector('[data-dgmo-clock]')!;
    expect(row.getAttribute('data-dgmo-clock-face')).toBe('digital');
    const main = row.querySelector('[data-dgmo-clock-digital-part="main"]')!;
    expect(main.textContent).toBe('4:30'); // 16:30 BST in 12h
    const sec = row.querySelector('[data-dgmo-clock-digital-part="sec"]')!;
    expect(sec.textContent).toBe(':07');
    expect(row.querySelector('[data-dgmo-clock-status]')).toBeNull();
  });

  it('renders one row per entry', () => {
    const c = renderAt(
      `clock Board\nAmerica/New_York\nLondon\nAsia/Tokyo`,
      FIXED_ISO
    );
    expect(c.querySelectorAll('[data-dgmo-clock]')).toHaveLength(3);
  });
});

// ============================================================
// Fixed UTC-offset rows (no DST)
// ============================================================

describe('clock renderer — fixed offset rows', () => {
  it('bakes a fixed-offset attr and a computed time (no Intl zone)', () => {
    const c = renderAt(`clock Ops\nUTC+5:30 as Bangalore`, FIXED_ISO);
    const row = c.querySelector('[data-dgmo-clock]')!;
    expect(row.getAttribute('data-dgmo-clock-fixed-offset')).toBe('330');
    // 15:30:07 UTC + 5:30 = 21:00 → 9:00 pm.
    const main = row.querySelector('[data-dgmo-clock-digital-part="main"]')!;
    expect(main.textContent).toBe('9:00');
    // No coords → no sun line.
    expect(row.querySelector('[data-dgmo-clock-sun-line]')).toBeNull();
  });

  it('marks a fixed row with a "no DST" note', () => {
    const c = renderAt(`clock Ops\nUTC-7 as Servers`, FIXED_ISO);
    const marked = [...c.querySelectorAll('text')].some((t) =>
      (t.textContent ?? '').includes('no DST')
    );
    expect(marked).toBe(true);
  });

  it('ticks a fixed row off UTC+offset', () => {
    const c = renderAt(`clock Ops\nUTC+1`, '2026-07-10T15:30:07Z');
    const main = () =>
      c.querySelector('[data-dgmo-clock-digital-part="main"]')!.textContent;
    expect(main()).toBe('4:30'); // 16:30
    vi.setSystemTime(Date.parse('2026-07-10T18:45:22Z')); // 19:45 +1
    tickClocks(c);
    expect(main()).toBe('7:45');
  });
});

// ============================================================
// Ticker — live update from baked state
// ============================================================

describe('clock ticker', () => {
  it('updates the digital readout to a new instant', () => {
    const c = renderAt(`clock Mum\nLondon`, '2026-07-10T15:30:07Z');
    const main = () =>
      c.querySelector('[data-dgmo-clock-digital-part="main"]')!.textContent;
    const sec = () =>
      c.querySelector('[data-dgmo-clock-digital-part="sec"]')!.textContent;
    expect(main()).toBe('4:30');
    vi.setSystemTime(Date.parse('2026-07-10T16:45:22Z')); // 17:45 BST
    tickClocks(c);
    expect(main()).toBe('5:45');
    expect(sec()).toBe(':22');
  });

  it('rotates analog hands and recolors on tick', () => {
    const c = renderAt(`clock T\nanalog\nLondon`, '2026-07-10T15:30:07Z');
    const hourHand = c.querySelector('[data-dgmo-clock-hand="h"]')!;
    const before = hourHand.getAttribute('transform');
    vi.setSystemTime(Date.parse('2026-07-10T18:30:07Z'));
    tickClocks(c);
    expect(hourHand.getAttribute('transform')).not.toBe(before);
  });

  it('repaints the work lane wash when status crosses work-start', () => {
    // 08:30 EDT Fri — within 60min of 9:00 start → "soon" (orange wash).
    const c = renderAt(
      `clock\nhours 9-5\ndays mon-fri\ncolor-by work\nNew York`,
      '2026-07-10T12:30:00Z'
    );
    const group = c.querySelector('[data-dgmo-clock]')!;
    const lane = c.querySelector('[data-dgmo-clock-lane]')!;
    const soonSoft = group.getAttribute('data-dgmo-clock-c-soon-soft');
    const okSoft = group.getAttribute('data-dgmo-clock-c-ok-soft');
    expect(lane.getAttribute('fill')).toBe(soonSoft);
    vi.setSystemTime(Date.parse('2026-07-10T14:00:00Z'));
    tickClocks(c);
    expect(lane.getAttribute('fill')).toBe(okSoft);
    expect(okSoft).not.toBe(soonSoft);
  });
});

describe('clock renderer — layout fit (scales, never overflows)', () => {
  afterEach(() => vi.useRealTimers());

  const LONG = [
    'clock Quarterly all-hands sync across every regional pod and office',
    'hours 9-17',
    'days mon-fri',
    '',
    'London as The London growth & partnerships pod',
    'Denver',
  ].join('\n');

  function renderWidth(source: string, clientWidth: number): HTMLDivElement {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-07-11T12:00:00Z'));
    const c = document.createElement('div');
    Object.defineProperty(c, 'clientWidth', { value: clientWidth });
    Object.defineProperty(c, 'clientHeight', { value: 600 });
    renderClock(c as HTMLDivElement, parseClock(source), nordLight, false);
    return c as HTMLDivElement;
  }

  it('clamps the layout width to a comfortable floor on a narrow panel', () => {
    const c = renderWidth(LONG, 300);
    const vb = c.querySelector('svg')!.getAttribute('viewBox')!;
    expect(vb.split(' ')[2]).toBe('460');
  });

  it('grows the columns-board width with the column count (fit scales it down)', () => {
    const widePanel = 1200;
    const cols = (n: number) =>
      [
        'clock Team',
        'direction lr',
        ...Array.from({ length: n }, (_, i) => `NYC as Office ${i}`),
      ].join('\n');
    const vbWidth = (n: number) =>
      Number(
        renderWidth(cols(n), widePanel)
          .querySelector('svg')!
          .getAttribute('viewBox')!
          .split(' ')[2]
      );
    // Few columns fill the panel floor; past ~4 the intrinsic canvas widens so
    // each column keeps a readable ~190px slot instead of clipping.
    expect(vbWidth(3)).toBeLessThanOrEqual(720);
    expect(vbWidth(6)).toBeGreaterThan(vbWidth(4));
    expect(vbWidth(8)).toBeGreaterThan(vbWidth(6));
    // Row mode ignores column count — never widens past the 720 ceiling.
    const rowVb = Number(
      renderWidth('clock T\nNYC\nLA\nMumbai\nDenver\nParis\nTokyo', widePanel)
        .querySelector('svg')!
        .getAttribute('viewBox')!
        .split(' ')[2]
    );
    expect(rowVb).toBeLessThanOrEqual(720);
  });

  it('ellipsizes a long title instead of overflowing', () => {
    const c = renderWidth(LONG, 300);
    const title = c.querySelector('text[data-line-number="1"]')!.textContent!;
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThan(
      'Quarterly all-hands sync across'.length + 5
    );
  });

  it('wraps a long row label to multiple lines instead of overflowing', () => {
    const c = renderWidth(LONG, 300);
    const row = c.querySelector('[data-dgmo-clock]')!;
    const aliasLines = [...row.querySelectorAll('text')].filter(
      (t) => t.getAttribute('font-weight') === '650'
    );
    expect(aliasLines.length).toBeGreaterThan(1);
  });

  it('lines every row label up at the same x despite varying time widths', () => {
    const src = [
      'clock World',
      'San Francisco as West',
      'New York as East',
      'Mumbai as Mumbai',
    ].join('\n');
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-07-11T12:00:00Z'));
    const c = document.createElement('div');
    Object.defineProperty(c, 'clientWidth', { value: 640 });
    Object.defineProperty(c, 'clientHeight', { value: 600 });
    renderClock(c as HTMLDivElement, parseClock(src), nordLight, false);
    const labelXs = [...c.querySelectorAll('[data-dgmo-clock]')].map((g) =>
      [...g.querySelectorAll('text')]
        .find((t) => t.getAttribute('font-weight') === '650')
        ?.getAttribute('x')
    );
    expect(new Set(labelXs).size).toBe(1);
  });

  it('keeps a short label in full at a wide layout', () => {
    const src = 'clock W\nLondon as UK team';
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-07-11T12:00:00Z'));
    const c = document.createElement('div');
    Object.defineProperty(c, 'clientWidth', { value: 700 });
    Object.defineProperty(c, 'clientHeight', { value: 400 });
    renderClock(c as HTMLDivElement, parseClock(src), nordLight, false);
    const full = [...c.querySelectorAll('text')].some(
      (t) => t.textContent === 'UK team'
    );
    expect(full).toBe(true);
  });
});

// ============================================================
// color-by
// ============================================================

describe('clock parser — color-by', () => {
  it('defaults to place', () => {
    expect(parseClock('clock T\nLondon').colorBy).toBe('place');
  });
  it('parses each dimension', () => {
    for (const m of ['place', 'work', 'daylight', 'time', 'none'] as const) {
      expect(parseClock(`clock T\ncolor-by ${m}\nLondon`).colorBy).toBe(m);
    }
  });
  it('bare `color-by` is the place default', () => {
    expect(parseClock('clock T\ncolor-by\nLondon').colorBy).toBe('place');
  });
  it('`color-by none` disables coloring', () => {
    expect(parseClock('clock T\ncolor-by none\nLondon').colorBy).toBe('none');
  });
  it('warns on an unknown dimension and keeps the default', () => {
    const r = parseClock('clock T\ncolor-by rainbow\nLondon');
    expect(r.colorBy).toBe('place');
    expect(warnings(r.diagnostics).length).toBeGreaterThan(0);
  });
});

describe('clock renderer — color-by', () => {
  it('place mode washes every row and colors the time solid', () => {
    const c = renderAt(
      'clock World\ncolor-by place\nLondon as UK\nTokyo as JP',
      FIXED_ISO
    );
    const rows = c.querySelectorAll('[data-dgmo-clock]');
    expect(rows).toHaveLength(2);
    const solids = [...rows].map((r) =>
      r.getAttribute('data-dgmo-clock-auto-solid')
    );
    expect(solids[0]).toBeTruthy();
    expect(solids[1]).toBeTruthy();
    expect(solids[0]).not.toBe(solids[1]);
    const main = rows[0]!.querySelector(
      '[data-dgmo-clock-digital-part="main"]'
    )!;
    expect(main.getAttribute('fill')).toBe(solids[0]);
  });

  it('color-by none leaves rows neutral (no baked solid, no lane wash)', () => {
    const c = renderAt('clock World\ncolor-by none\nLondon as UK', FIXED_ISO);
    const row = c.querySelector('[data-dgmo-clock]')!;
    expect(row.getAttribute('data-dgmo-clock-auto-solid')).toBeNull();
    expect(row.querySelector('rect')).toBeNull();
  });

  it('a hand-set per-zone shade overrides the dimension', () => {
    const c = renderAt(
      'clock World\ncolor-by daylight\nLondon as UK purple\nTokyo as JP',
      FIXED_ISO
    );
    const rows = c.querySelectorAll('[data-dgmo-clock]');
    const purple = getPalette('nord').light.colors.purple;
    expect(rows[0]!.getAttribute('data-dgmo-clock-auto-solid')).toBe(purple);
    expect(rows[1]!.getAttribute('data-dgmo-clock-auto-solid')).not.toBe(
      purple
    );
  });

  it('ticker repaints the analog dial in the resolved color, not day/night', () => {
    const c = renderAt(
      'clock Desks\nanalog\ncolor-by place\nLondon as UK',
      FIXED_ISO
    );
    const row = c.querySelector('[data-dgmo-clock]')!;
    const solid = row.getAttribute('data-dgmo-clock-auto-solid')!;
    const dayC = row.getAttribute('data-dgmo-clock-c-day')!;
    tickClocks(c);
    const second = row.querySelector('[data-dgmo-clock-hand="s"]')!;
    expect(second.getAttribute('stroke')).toBe(solid);
    expect(second.getAttribute('stroke')).not.toBe(dayC);
    const ring = row.querySelector('[data-dgmo-clock-facering]')!;
    expect(ring.getAttribute('stroke')).toBe(solid);
  });
});

// ============================================================
// §1.9 fill family (fill-tint / fill-solid / fill-outline)
// ============================================================

describe('clock parser — §1.9 fill family', () => {
  it('defaults to no fillMode (canonical tint)', () => {
    expect(parseClock('clock T\nLondon').fillMode).toBeUndefined();
  });

  it('parses the tokens as board directives, not place rows', () => {
    const r = parseClock('clock T\nfill-outline\nLondon');
    expect(r.fillMode).toBe('outline');
    expect(r.entries).toHaveLength(1);
    expect(r.diagnostics).toHaveLength(0); // no "Unknown place" warning
    expect(parseClock('clock T\nfill-solid\nLondon').fillMode).toBe('solid');
  });

  it('is mutually exclusive, last one wins; fill-tint resets', () => {
    expect(
      parseClock('clock T\nfill-solid\nfill-outline\nLondon').fillMode
    ).toBe('outline');
    expect(
      parseClock('clock T\nfill-outline\nfill-tint\nLondon').fillMode
    ).toBeUndefined();
  });
});

describe('clock renderer — §1.9 fill family', () => {
  const baseBg = themeBaseBg(nordLight, false);

  it('fill-outline empties the card, lane wash, and dial face to the base bg; the color stays on the ring', () => {
    const c = renderAt(
      'clock World\nanalog\nfill-outline\nLondon as UK',
      FIXED_ISO
    );
    const card = c.querySelectorAll('svg > rect')[1]!; // [0] = page bg
    expect(card.getAttribute('fill')).toBe(baseBg);
    const row = c.querySelector('[data-dgmo-clock]')!;
    const solid = row.getAttribute('data-dgmo-clock-auto-solid')!;
    expect(
      row.querySelector('[data-dgmo-clock-lane]')!.getAttribute('fill')
    ).toBe(baseBg);
    expect(
      row.querySelector('[data-dgmo-clock-facebg]')!.getAttribute('fill')
    ).toBe(baseBg);
    expect(
      row.querySelector('[data-dgmo-clock-facering]')!.getAttribute('stroke')
    ).toBe(solid);
  });

  it('fill-outline survives a live tick (no revert to the tint wash)', () => {
    const c = renderAt(
      'clock Desks\nanalog\nfill-outline\nLondon as UK',
      FIXED_ISO
    );
    tickClocks(c);
    const row = c.querySelector('[data-dgmo-clock]')!;
    expect(
      row.querySelector('[data-dgmo-clock-facebg]')!.getAttribute('fill')
    ).toBe(baseBg);
    expect(
      row.querySelector('[data-dgmo-clock-lane]')!.getAttribute('fill')
    ).toBe(baseBg);
  });

  it('fill-solid saturates the dial face and swaps the hands to contrast ink', () => {
    const c = renderAt(
      'clock Desks\nanalog\nfill-solid\nLondon as UK',
      FIXED_ISO
    );
    const row = c.querySelector('[data-dgmo-clock]')!;
    const solid = row.getAttribute('data-dgmo-clock-auto-solid')!;
    const ink = contrastText(
      solid,
      nordLight.textOnFillLight,
      nordLight.textOnFillDark
    );
    expect(
      row.querySelector('[data-dgmo-clock-facebg]')!.getAttribute('fill')
    ).toBe(solid);
    expect(
      row.querySelector('[data-dgmo-clock-hand="h"]')!.getAttribute('stroke')
    ).toBe(ink);
    expect(
      row.querySelector('[data-dgmo-clock-hand="s"]')!.getAttribute('stroke')
    ).toBe(ink);
  });

  it('columns mode honors fill-outline on every lane', () => {
    const c = renderAt(
      'clock W\ndirection lr\nfill-outline\nLondon as UK\nTokyo as JP',
      FIXED_ISO
    );
    const lanes = c.querySelectorAll('[data-dgmo-clock-lane]');
    expect(lanes).toHaveLength(2);
    for (const l of lanes) expect(l.getAttribute('fill')).toBe(baseBg);
  });

  it('state-encoding fills are exempt: daylight lane/face tints and the status dot keep their fills', () => {
    const c = renderAt(
      'clock Team\nanalog\ncolor-by daylight\nhours 9-17\nfill-outline\nLondon as UK',
      FIXED_ISO
    );
    const row = c.querySelector('[data-dgmo-clock]')!;
    // 16:30 BST → daytime, in-hours: lane + face keep the day tint, dot stays ok.
    expect(
      row.querySelector('[data-dgmo-clock-lane]')!.getAttribute('fill')
    ).toBe(row.getAttribute('data-dgmo-clock-c-day-soft'));
    expect(
      row.querySelector('[data-dgmo-clock-facebg]')!.getAttribute('fill')
    ).not.toBe(baseBg);
    expect(
      row.querySelector('[data-dgmo-clock-status-icon]')!.getAttribute('fill')
    ).toBe(row.getAttribute('data-dgmo-clock-c-ok'));
  });
});
