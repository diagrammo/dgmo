import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §7 §6.5 Options: direction-tb, sub-node-label, show-sub-node-count,
// hide, active-tag, focus. fill family via FILL_FAMILY_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'org',
  structuralKeywords: ['tag'],
  specSection: '7',
  firstLineKeyword: 'org',
  directives: [
    ...FRAME_DIRECTIVES,
    'no-legend',
    'direction-tb',
    'direction-lr',
    'sub-node-label',
    'show-sub-node-count',
    'hide',
    'active-tag',
    'focus',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {
    node: ['description', 'role', 'location', 'email', 'phone'],
  },
};
