import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §27 (Swimlane). Lanes and pools are block openers; `[Phase]` columns are
// bracket headings, not keywords. BPMN task-marker keys ride on the node line.
export const fixture: ConformanceFixture = {
  chartType: 'swimlane',
  specSection: '27',
  firstLineKeyword: 'swimlane',
  structuralKeywords: ['pool', 'lane', 'tag'],
  directives: [
    ...FRAME_DIRECTIVES,
    'direction-lr',
    'direction-tb',
    // Block openers are also offered as line-start completions.
    'lane',
    'pool',
    'active-tag',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: { node: ['type', 'store', 'data', 'note'] },
};
