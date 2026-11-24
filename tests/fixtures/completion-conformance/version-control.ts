import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §29 (Version-Control). The verbs are line-leading structural tokens; the
// registry also lists them as directives so they complete at indent 0.
export const fixture: ConformanceFixture = {
  chartType: 'version-control',
  specSection: '29',
  firstLineKeyword: 'version-control',
  structuralKeywords: [
    'merge',
    'cherry-pick',
    'rebase',
    'reset',
    'revert',
    'ref',
    'note',
  ],
  directives: [
    ...FRAME_DIRECTIVES,
    'direction-lr',
    'direction-tb',
    'no-labels',
    'no-lanes',
    'no-head',
  ],
  // Verbs the registry offers in the directive list too (§29.4, §29.7-29.9).
  allowExtras: [
    'merge',
    'cherry-pick',
    'rebase',
    'reset',
    'revert',
    'ref',
    'note',
  ],
  // §29.2-29.3: same-line metadata on branch and commit lines.
  pipeKeys: { node: ['id', 'tag', 'type', 'order'] },
};
