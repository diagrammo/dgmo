// #2040: a lowercase `highlight` line is reserved on every chart type. On a
// type that cannot read it yet it warns once and draws nothing — never an
// element named "highlight …". Covers every type in the registry.
import { describe, it, expect } from 'vitest';
import { validate } from '../src/index';
import { render } from '../src/render';
import { knownChartTypeIds } from '../src/dgmo-router';
import { DIRECTIVES_REGISTRY } from '../src/directives-registry';
import {
  HIGHLIGHT_CHART_TYPES,
  liftUnsupportedHighlight,
} from '../src/utils/emphasis';

const unsupported = knownChartTypeIds.filter(
  (id) => !HIGHLIGHT_CHART_TYPES.has(id)
);
const doc = (id: string) => `${id}\nhighlight Zed\nAlpha\n`;

describe('highlight on a chart type that cannot read it (#2040)', () => {
  it('names only registry types, the same ones the editor highlights', () => {
    const entry = DIRECTIVES_REGISTRY.find((d) => d.token === 'highlight');
    expect([...HIGHLIGHT_CHART_TYPES].sort()).toEqual(
      [...(entry?.chartTypes ?? [])].sort()
    );
    for (const id of HIGHLIGHT_CHART_TYPES)
      expect(knownChartTypeIds).toContain(id);
  });

  it.each(unsupported)('%s warns once, on the highlight line', (id) => {
    const { diagnostics } = validate(doc(id));
    const hits = diagnostics.filter(
      (d) => d.code === 'W_HIGHLIGHT_UNSUPPORTED'
    );
    expect(hits).toEqual([
      expect.objectContaining({
        line: 2,
        severity: 'warning',
        message: `highlight is not supported on ${id} yet`,
      }),
    ]);
    // No other diagnostic reads the line as content.
    for (const d of diagnostics)
      if (d !== hits[0]) expect(d.message).not.toContain('highlight Zed');
  });

  it.each(unsupported)('%s draws no "highlight …" element', async (id) => {
    const { svg, diagnostics } = await render(doc(id));
    expect(svg).not.toMatch(/highlight Zed/i);
    expect(diagnostics.map((d) => d.code)).toContain('W_HIGHLIGHT_UNSUPPORTED');
  });

  it.each([...HIGHLIGHT_CHART_TYPES])('%s keeps its own highlight', (id) => {
    const { diagnostics } = validate(doc(id));
    expect(diagnostics.map((d) => d.code)).not.toContain(
      'W_HIGHLIGHT_UNSUPPORTED'
    );
  });

  it('leaves a capitalised Highlight as content', async () => {
    const src = 'boxes-and-lines\nHighlight Reel\n';
    expect(liftUnsupportedHighlight(src, 'boxes-and-lines')).toEqual({
      content: src,
      diagnostics: [],
    });
    const { svg } = await render(src);
    expect(svg).toContain('Highlight Reel');
  });

  it('keeps line numbers: the lifted line becomes a comment', () => {
    const lifted = liftUnsupportedHighlight(
      'flowchart\nhighlight A\n(Start) -> [A]',
      'flowchart'
    );
    expect(lifted.content).toBe('flowchart\n//\n(Start) -> [A]');
  });
});
