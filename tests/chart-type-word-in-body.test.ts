import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { parseOrg } from '../src/org/parser';
import { parseMindmap } from '../src/mindmap/parser';
import { parseKanban } from '../src/kanban/parser';
import { parseJourneyMap } from '../src/journey-map/parser';

// #1942: only the first content line is the chart declaration. A tag value or
// a node named after a chart type (Family, Kanban, Timeline) inside the first
// five lines is content, not a second declaration.

const TAGS = 'tag Kind as k\n  Work blue\n  Family green\n  Kanban red\n';
// kanban and journey-map read the header only after the tag group closes.
const TAGS_CLOSED = `${TAGS}\n`;

const cases: [
  string,
  () => {
    error?: string | null;
    diagnostics: { severity: string; message: string }[];
  },
][] = [
  [
    'boxes-and-lines',
    () =>
      parseBoxesAndLines(`boxes-and-lines Test\n${TAGS}Family\nA k: Work\n`),
  ],
  ['org', () => parseOrg(`org Test\n${TAGS}Family\n  Timeline\n`)],
  ['mindmap', () => parseMindmap(`mindmap Test\n${TAGS}Family\n  Timeline\n`)],
  [
    'kanban',
    () => parseKanban(`kanban Test\n${TAGS_CLOSED}Family\n[A]\n  Timeline\n`),
  ],
  [
    'journey-map',
    () =>
      parseJourneyMap(
        `journey-map Test\n${TAGS_CLOSED}Family\n[A]\n  Timeline score: 3\n`
      ),
  ],
];

describe('chart-type word after the declaration line (#1942)', () => {
  it.each(cases)('%s reads it as content', (_name, parse) => {
    const result = parse();
    expect(result.error ?? null).toBeNull();
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual(
      []
    );
  });

  it.each([
    ['boxes-and-lines', () => parseBoxesAndLines('org Test\nA\n')],
    ['org', () => parseOrg('kanban Test\nA\n')],
    ['mindmap', () => parseMindmap('org Test\nA\n')],
    ['kanban', () => parseKanban('org Test\n[A]\n')],
    ['journey-map', () => parseJourneyMap('kanban Test\n[A]\n')],
  ] as const)('%s still rejects a wrong first line', (_name, parse) => {
    expect(parse().error).toMatch(/Expected chart type/);
  });
});
