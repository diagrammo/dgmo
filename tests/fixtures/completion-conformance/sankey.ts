import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES, NUMBER_FORMAT_DIRECTIVES } from './_frame';

// Spec §16 / §15.5. Flow family — name suppression deferred to Phase 2c
// (§15.1 table). The emphasis family (§1.11, decision #49) is sankey's only
// chart-specific directive pair: `highlight` lights a node's upstream +
// downstream flow closure and recedes the rest, `dim` recedes exactly the
// named nodes. Mutually exclusive, last-one-wins. Node values (#1837) take the
// #1831 number format, and `no-value` hides them.
export const fixture: ConformanceFixture = {
  chartType: 'sankey',
  specSection: '16',
  firstLineKeyword: 'sankey',
  directives: [
    ...FRAME_DIRECTIVES,
    ...NUMBER_FORMAT_DIRECTIVES,
    'no-value',
    'highlight',
    'dim',
  ],
  pipeKeys: {},
};
