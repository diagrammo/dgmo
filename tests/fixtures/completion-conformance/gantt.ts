import type { ConformanceFixture } from './_types';

// Spec §13 §12.2 Options. `dependencies` in current completion is the
// inverse of spec's `no-dependencies` — kept in allowExtras as legacy.
export const fixture: ConformanceFixture = {
  chartType: 'gantt',
  structuralKeywords: [
    'era',
    'marker',
    'holiday',
    'workweek',
    'parallel',
    'tag',
  ],
  specSection: '13',
  firstLineKeyword: 'gantt',
  directives: [
    'start',
    'today-marker',
    'critical-path',
    'no-dependencies',
    'sort',
    'active-tag',
    'sprint-length',
    'sprint-number',
    'sprint-start',
  ],
  pipeKeys: {
    node: [],
    edge: ['offset'],
  },
  allowExtras: ['dependencies'], // legacy positive form
  enumChecks: [
    { directive: 'palette', source: 'palettes' },
    { directive: 'sort', values: ['time', 'group', 'tag'] },
  ],
};
