/**
 * The `COLOR_DIRECTIVES` table is a claim about what the parsers do, and an
 * unchecked claim drifts: the app's private copy of it once painted a color on
 * `marker 2026-03-27 orange`, which names a milestone "orange" and colors
 * nothing. So every entry is driven through its real parser here.
 *
 * Each fixture states, for one directive:
 *   - `colored`  — a line whose trailing token(s) MUST peel, and the label
 *                  that must survive underneath
 *   - `bare`     — a line whose lone trailing token is the LABEL, which must
 *                  NOT peel (omitted where the label is optional)
 *   - `plain`    — the same line with no color at all
 *
 * A table entry with no fixture fails the completeness test at the bottom, so
 * a new color-bearing directive cannot be added without being checked.
 */

import { describe, expect, it } from 'vitest';

import { COLOR_DIRECTIVES } from '../src/editor/color-directives';
import { parseEventLine } from '../src/event-line/parser';
import { parseGantt } from '../src/gantt/parser';
import { parseSwimlane } from '../src/swimlane/parser';
import { parseJourneyMap } from '../src/journey-map/parser';
import { parseMap } from '../src/map/parser';
import { parseVisualization } from '../src/d3';

/** What a parser reports for one directive line: its colors and its label. */
interface Peeled {
  /** Resolved colors, in source order. Length is what the table's `max` bounds. */
  colors: string[];
  /** The label the color peeled OFF — proof it did not land in the text. */
  label: string | null;
}

interface Fixture {
  /** A line whose color(s) must peel, and the label left behind. */
  colored: { line: string; colors: number; label: string | null };
  /** A lone trailing color token that is really the label. Omit if optional. */
  bare?: { line: string; label: string };
  /** The same directive with no color at all. */
  plain: { line: string; label: string | null };
  read: (line: string) => Peeled;
}

const truthy = (...v: Array<string | null | undefined>): string[] =>
  v.filter((x): x is string => Boolean(x));

const FIXTURES: Record<string, Fixture> = {
  'event-line:now': {
    colored: { line: 'now 2024-06-01 Today teal', colors: 1, label: 'Today' },
    plain: { line: 'now 2024-06-01 Today', label: 'Today' },
    read: (line) => {
      const p = parseEventLine(`event-line X\n${line}\n\n2023-01 A\n2025-01 B`);
      return { colors: truthy(p.now?.color), label: p.now?.label ?? null };
    },
  },
  'gantt:marker': {
    colored: {
      line: 'marker 2026-03-27 Board Review orange',
      colors: 1,
      label: 'Board Review',
    },
    // A date is not a label, so the lone token names the milestone.
    bare: { line: 'marker 2026-03-27 orange', label: 'orange' },
    plain: { line: 'marker 2026-03-27 Board Review', label: 'Board Review' },
    read: (line) => {
      const m = parseGantt(`gantt P\n\n${line}\nA 3d\n`).markers[0];
      return { colors: truthy(m?.color), label: m?.label ?? null };
    },
  },
  'swimlane:lane': {
    colored: { line: 'lane Writer gray', colors: 1, label: 'Writer' },
    bare: { line: 'lane gray', label: 'gray' },
    plain: { line: 'lane Writer', label: 'Writer' },
    read: (line) => {
      const l = parseSwimlane(`swimlane F\n${line}\n  Draft\n`).lanes[0];
      return { colors: truthy(l?.color), label: l?.label ?? null };
    },
  },
  'journey-map:persona': {
    colored: { line: 'persona Nadia green', colors: 1, label: 'Nadia' },
    bare: { line: 'persona green', label: 'green' },
    plain: { line: 'persona Nadia', label: 'Nadia' },
    read: (line) => {
      const p = parseJourneyMap(
        `journey-map T\n${line}\n\n[Start]\n  Book score: 4\n`
      );
      return {
        colors: truthy(p.persona?.color),
        label: p.persona?.name ?? null,
      };
    },
  },
  'map:region-heat': {
    // The one two-color entry — a value ramp's low and high ends.
    colored: { line: 'region-heat Peril green red', colors: 2, label: 'Peril' },
    bare: { line: 'region-heat blue', label: 'blue' },
    plain: { line: 'region-heat Peril', label: 'Peril' },
    read: (line) => {
      const d = parseMap(`map World\n${line}\nFrance 12\n`).directives;
      return {
        colors: truthy(d.regionMetricLowColor, d.regionMetricColor),
        label: d.regionMetric ?? null,
      };
    },
  },
};

/** The four quadrant position labels share one parse path and one shape. */
for (const pos of [
  'top-right',
  'top-left',
  'bottom-right',
  'bottom-left',
] as const) {
  const key = pos.replace(/-(\w)/, (_, c: string) => c.toUpperCase()) as
    | 'topRight'
    | 'topLeft'
    | 'bottomRight'
    | 'bottomLeft';
  FIXTURES[`quadrant:${pos}`] = {
    colored: { line: `${pos} Promote green`, colors: 1, label: 'Promote' },
    bare: { line: `${pos} green`, label: 'green' },
    plain: { line: `${pos} Promote`, label: 'Promote' },
    read: (line) => {
      const q = parseVisualization(`quadrant Bets\n${line}\nThing 3 4\n`);
      const cell = q.quadrantLabels?.[key];
      return { colors: truthy(cell?.color), label: cell?.text ?? null };
    },
  };
}

describe('COLOR_DIRECTIVES matches what the parsers actually do', () => {
  for (const [key, fx] of Object.entries(FIXTURES)) {
    const [chartType, directive] = key.split(':') as [string, string];
    const rule = COLOR_DIRECTIVES.get(chartType)?.get(directive);

    describe(key, () => {
      it('is in the table', () => {
        expect(rule, `${key} has a fixture but no table entry`).toBeDefined();
      });

      it('peels its trailing color, leaving the label intact', () => {
        const got = fx.read(fx.colored.line);
        expect(got.colors).toHaveLength(fx.colored.colors);
        expect(got.label).toBe(fx.colored.label);
      });

      it('declares a max no smaller than what it peels', () => {
        expect(rule!.max).toBeGreaterThanOrEqual(fx.colored.colors);
      });

      it('peels nothing when no color is written', () => {
        const got = fx.read(fx.plain.line);
        expect(got.colors).toHaveLength(0);
        expect(got.label).toBe(fx.plain.label);
      });

      if (fx.bare) {
        it('treats a lone trailing color as the label, not a color', () => {
          const got = fx.read(fx.bare!.line);
          expect(got.colors).toHaveLength(0);
          expect(got.label).toBe(fx.bare!.label);
          expect(
            rule!.labelOptional,
            `${key} has a bare fixture, so its label is required`
          ).not.toBe(true);
        });
      } else {
        it('has an optional label, so a color may stand alone', () => {
          expect(rule!.labelOptional).toBe(true);
        });
      }
    });
  }

  it('has a fixture for every table entry', () => {
    const entries: string[] = [];
    for (const [chartType, directives] of COLOR_DIRECTIVES) {
      for (const directive of directives.keys()) {
        entries.push(`${chartType}:${directive}`);
      }
    }
    expect(entries.sort()).toEqual(Object.keys(FIXTURES).sort());
  });
});

describe('a directive with an optional label', () => {
  it('colors the pin with no caption at all', () => {
    // `now`'s whole point: bare, and pinned-but-uncaptioned, both color.
    for (const line of ['now teal', 'now 2024-06-01 teal']) {
      const p = parseEventLine(`event-line X\n${line}\n\n2023-01 A\n2025-01 B`);
      expect(p.now?.color, line).toBe('teal');
      expect(p.now?.label, line).toBeNull();
    }
  });
});
