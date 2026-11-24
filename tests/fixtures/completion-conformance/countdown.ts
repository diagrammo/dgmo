import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §36 (Countdown). All directives are space-separated key-value.
export const fixture: ConformanceFixture = {
  chartType: 'countdown',
  specSection: '36',
  firstLineKeyword: 'countdown',
  directives: [
    ...FRAME_DIRECTIVES,
    // Universal date directives (§2B).
    'year',
    'date-order',
    'no-current-year',
    'target',
    'tz',
    'expired',
    'since',
    'every',
    'since-label',
    'units',
    'round',
    'fields',
    'lang',
    'no-visual',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  // Spec/parser disagreement: the parser accepts `on-day <text>` (the text shown
  // on a recurring occurrence day) and the registry offers it, but §36 does not
  // document it.
  allowExtras: ['on-day'],
  pipeKeys: {},
};
