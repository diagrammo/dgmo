import type { ConformanceFixture } from './_types';

// Spec §6 §5.6 Options: direction-tb, fill family, no-notes, active-tag.
// Decision #48 granted state the standard tag system (§5.7 "Tags"), so it
// gained the `tag` block keyword and the `active-tag` option. `note` was
// already parser-recognized (state note annotations) and is now declared.
export const fixture: ConformanceFixture = {
  chartType: 'state',
  structuralKeywords: ['note', 'tag'],
  specSection: '6',
  firstLineKeyword: 'state',
  directives: [
    'no-legend',
    'direction-tb',
    'direction-lr',
    'fill-tint',
    'fill-solid',
    'fill-outline',
    'no-notes',
    'active-tag',
  ],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
