// @vitest-environment jsdom
// Tag mode of the calendar heatmap — year in pixels (#1855, #1877).
import { describe, expect, it, vi } from 'vitest';
import { calendarSummary } from '../src/calendar-heatmap/format';
import { parseCalendarHeatmap } from '../src/calendar-heatmap/parser';
import { renderCalendarHeatmap } from '../src/calendar-heatmap/renderer';
import { resolveColor } from '../src/colors';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

const MOOD = `calendar-heatmap My year in pixels
year 2026
tag Mood
  Great green
  Ok blue
  Rough red

01-01 Great
01-02 ok
01-03 Rough
01-05 Great
`;

const codes = (src: string) =>
  parseCalendarHeatmap(src).diagnostics.map((d) => d.code);

function draw(src: string): HTMLElement {
  const parsed = parseCalendarHeatmap(src);
  expect(parsed.error).toBeNull();
  const container = document.createElement('div');
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    width: 0,
  } as DOMRect);
  renderCalendarHeatmap(container, parsed, palette, false);
  return container;
}

describe('calendar-heatmap tag mode — parser', () => {
  it('reads a tag group and gives each day its value, in the group spelling', () => {
    const p = parseCalendarHeatmap(MOOD);
    expect(p.error).toBeNull();
    expect(p.mode).toBe('tag');
    expect(p.tagGroups.map((g) => g.name)).toEqual(['Mood']);
    expect(p.tagGroups[0]!.entries.map((e) => e.value)).toEqual([
      'Great',
      'Ok',
      'Rough',
    ]);
    expect(p.days.map((d) => [d.date, d.tag])).toEqual([
      ['2026-01-01', 'Great'],
      ['2026-01-02', 'Ok'],
      ['2026-01-03', 'Rough'],
      ['2026-01-05', 'Great'],
    ]);
  });

  it('keeps number mode when no tag group is declared', () => {
    const p = parseCalendarHeatmap('calendar-heatmap\nyear 2026\n01-01 3\n');
    expect(p.mode).toBe('value');
    expect(p.tagGroups).toEqual([]);
    expect(p.days[0]!.value).toBe(3);
  });

  it('reads a multi-word tag value and inline values on the heading', () => {
    const p = parseCalendarHeatmap(`calendar-heatmap
year 2026
tag Mood Great green, Not great red

01-01 Not great
`);
    expect(p.error).toBeNull();
    expect(p.days[0]!.tag).toBe('Not great');
  });

  it('refuses numbers and tags in one chart', () => {
    const src = `calendar-heatmap
year 2026
tag Mood
  Great green

01-01 Great
01-02 4
`;
    expect(codes(src)).toContain('E_CALENDAR_HEATMAP_MIXED_ENTRIES');
    const p = parseCalendarHeatmap(src);
    expect(p.diagnostics[0]!.line).toBe(7);
    expect(p.error).not.toBeNull();
  });

  it('refuses a value no tag group declares, and suggests the near one', () => {
    const p = parseCalendarHeatmap(`calendar-heatmap
year 2026
tag Mood
  Great green

01-01 Graet
`);
    const d = p.diagnostics.find(
      (x) => x.code === 'E_CALENDAR_HEATMAP_UNKNOWN_TAG'
    );
    expect(d?.line).toBe(6);
    expect(d?.message).toContain("'Graet' is not a value of any tag group.");
    expect(d?.message).toContain('Great');
    expect(d?.message).not.toContain("'Graet' (");
  });

  it('warns on a day tagged twice, and the later line wins', () => {
    const src = `calendar-heatmap
year 2026
tag Mood
  Great green
  Rough red

01-01 Great
01-01 Rough
`;
    expect(codes(src)).toEqual(['W_CALENDAR_HEATMAP_DUPLICATE_TAG_DAY']);
    expect(parseCalendarHeatmap(src).days[0]!.tag).toBe('Rough');
  });

  it('draws an empty tagged year when the group has no entries yet', () => {
    const p = parseCalendarHeatmap(
      'calendar-heatmap\nyear 2026\ntag Mood\n  Great green\n'
    );
    expect(p.error).toBeNull();
    expect(p.mode).toBe('tag');
    expect(p.days).toEqual([]);
  });
});

describe('calendar-heatmap tag mode — renderer', () => {
  it("colours each tagged day by its value and the rest as 'Not logged'", () => {
    const c = draw(MOOD);
    const day = (date: string) =>
      c.querySelector(`.calendar-heatmap-day[data-date="${date}"]`)!;
    expect(day('2026-01-01').getAttribute('fill')).toBe(
      resolveColor('green', palette)
    );
    expect(day('2026-01-03').getAttribute('fill')).toBe(
      resolveColor('red', palette)
    );
    expect(day('2026-01-01').getAttribute('data-tag')).toBe('Great');
    expect(day('2026-01-04').getAttribute('data-tag')).toBeNull();
    expect(day('2026-01-04').getAttribute('aria-label')).toBe(
      'Sunday, January 4, 2026: Not logged'
    );
    expect(day('2026-01-02').getAttribute('aria-label')).toBe(
      'Friday, January 2, 2026: Ok'
    );
    // Every untagged day shares one fill, distinct from every tag colour.
    const untagged = day('2026-01-04').getAttribute('fill');
    expect(day('2026-06-01').getAttribute('fill')).toBe(untagged);
    expect([
      resolveColor('green', palette),
      resolveColor('blue', palette),
      resolveColor('red', palette),
    ]).not.toContain(untagged);
  });

  it("lists the tag values and 'Not logged' in the legend, not Less … More", () => {
    const c = draw(MOOD);
    const items = [
      ...c.querySelectorAll('.calendar-heatmap-legend-tag text'),
    ].map((t) => t.textContent);
    expect(items).toEqual(['Great', 'Ok', 'Rough', 'Not logged']);
    expect(c.querySelector('.calendar-heatmap-legend-step')).toBeNull();
    expect(c.textContent).not.toContain('Less');
  });

  it('gives a bare tag value a palette colour of its own', () => {
    const c = draw(`calendar-heatmap
year 2026
tag Mood
  Great
  Rough

01-01 Great
01-02 Rough
`);
    const f = (date: string) =>
      c
        .querySelector(`.calendar-heatmap-day[data-date="${date}"]`)!
        .getAttribute('fill');
    expect(f('2026-01-01')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(f('2026-01-01')).not.toBe(f('2026-01-02'));
  });

  it('summarises the days logged and the most frequent value', () => {
    expect(calendarSummary(parseCalendarHeatmap(MOOD))).toBe(
      '4 days logged · most often Great'
    );
  });
});
