import type { HighlightFixture } from './_types';

// Note: `mobile` is in CONTROL_KEYWORDS (wireframe element shape) AND
// the directive `mobile` (form-factor option). Current highlighter
// classifies it as controlKeyword. Acceptable — it's still highlighted,
// just under a different role than other directives. Asserting that
// here so the test reflects current behavior.
export const fixture: HighlightFixture = {
  chartType: 'wireframe',
  specSection: '19',
  source: `wireframe Login
mobile
active-tag X

[Header]
  logo
  nav
    Dashboard
`,
  assertions: [
    { text: 'wireframe', role: 'chartType' },
    { text: 'mobile', role: 'controlKeyword' },
    { text: 'active-tag', role: 'keyword' },
    { text: 'nav', role: 'controlKeyword' },
  ],
};
