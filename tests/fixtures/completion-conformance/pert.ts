import type { ConformanceFixture } from './_types';

// Spec §21 (PERT Charts). Directives: time-unit, confidence, direction,
// node-detail, trials, seed, scrubber-trials, start-date, end-date,
// sprint-length, sprint-number, sprint-start, active-tag.
export const fixture: ConformanceFixture = {
  chartType: 'pert',
  structuralKeywords: ['tag'],
  specSection: '21',
  firstLineKeyword: 'pert',
  directives: [
    'time-unit',
    'confidence',
    'direction',
    'node-detail',
    'trials',
    'seed',
    'scrubber-trials',
    'start-date',
    'end-date',
    'sprint-length',
    'sprint-number',
    'sprint-start',
    'active-tag',
    'fill-tint',
    'fill-solid',
    'fill-outline',
    // Universal date directives (§ BL-121).
    'year',
    'date-order',
    'no-current-year',
  ],
  pipeKeys: {
    node: ['description', 'confidence', 'collapsed'],
  },
  enumChecks: [
    { directive: 'palette', source: 'palettes' },
    {
      directive: 'time-unit',
      // `sp` = sprints is the canonical unit (decision #48; bare `s` is the
      // undocumented legacy alias, not offered).
      values: ['min', 'h', 'd', 'bd', 'w', 'm', 'q', 'y', 'sp'],
    },
    { directive: 'confidence', values: ['high', 'medium', 'low'] },
    { directive: 'direction', values: ['LR', 'TB'] },
    { directive: 'node-detail', values: ['compact', 'full'] },
  ],
};
