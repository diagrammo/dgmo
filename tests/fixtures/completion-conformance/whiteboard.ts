import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §39 (Whiteboard). Elements are keyword-led lines (§39.2); geometry and
// style ride as same-line `key: value` pairs.
export const fixture: ConformanceFixture = {
  chartType: 'whiteboard',
  specSection: '39',
  firstLineKeyword: 'whiteboard',
  structuralKeywords: [
    'rectangle',
    'ellipse',
    'database',
    'queue',
    'file',
    'note',
    'arrow',
    'line',
    'text',
    'image',
    'ink',
    'tag',
  ],
  // Spec/parser disagreement: the parser accepts a `shapes` line (bundled glyph
  // sets, #1845) and the registry offers it, but §39 does not document it.
  allowExtraStructural: ['shapes'],
  directives: [...FRAME_DIRECTIVES, 'no-notes'],
  pipeKeys: {
    node: [
      'at',
      'size',
      'color',
      'from',
      'to',
      'style',
      'heads',
      'bend',
      'fill',
      'label',
    ],
  },
};
