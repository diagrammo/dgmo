import { describe, expect, it } from 'vitest';

import { render } from '../src/render';

/**
 * An embed (a doc-site wrapper, Obsidian) has no swimlane picker, so it calls
 * `render()` with no `viewState`. Gantt and timeline must then band their rows
 * by the source's own `lane-by <group>`: one lane per tag value. #1370.
 */

// The options an embed passes: theme and palette, and never a viewState.
const EMBED_OPTIONS = { theme: 'light', palette: 'slate' } as const;

const GANTT_BODY = `start-date 2026-01-05
tag Team
  Hull blue
  Deck green
Caulk seams 3bd team: Hull
Patch planks 2bd team: Hull
Sand deck 4bd team: Deck`;

const TIMELINE_BODY = `tag Era
  Ancient blue
  Modern green
1000 Founding era: Ancient
1200 Charter era: Ancient
2000 Reform era: Modern`;

async function renderEmbed(source: string): Promise<string> {
  const { svg, diagnostics } = await render(source, EMBED_OPTIONS);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return svg;
}

function laneAttrs(svg: string, cls: string, attr: string): string[] {
  const re = new RegExp(`<g[^>]*class="${cls}"[^>]*>`, 'g');
  return (svg.match(re) ?? []).map((tag) => {
    const m = tag.match(new RegExp(`${attr}="([^"]*)"`));
    return m ? m[1]! : '';
  });
}

describe('an embed honours `lane-by` (render() with no viewState)', () => {
  it('bands a gantt by the lane-by group, one lane per tag value', async () => {
    const svg = await renderEmbed(`gantt\nlane-by Team\n${GANTT_BODY}`);
    expect(laneAttrs(svg, 'gantt-lane-header', 'data-lane').sort()).toEqual([
      'Deck',
      'Hull',
    ]);
  });

  it('draws no gantt lanes when the source sets no lane-by', async () => {
    const svg = await renderEmbed(`gantt\n${GANTT_BODY}`);
    expect(laneAttrs(svg, 'gantt-lane-header', 'data-lane')).toEqual([]);
  });

  // A timeline's default (horizontal) layout heads each lane with a
  // `tl-group-header`; `tl-lane-header` is the vertical layout's.
  it('bands a timeline by the lane-by group, one lane per tag value', async () => {
    const svg = await renderEmbed(`timeline\nlane-by Era\n${TIMELINE_BODY}`);
    expect(laneAttrs(svg, 'tl-group-header', 'data-group').sort()).toEqual([
      'Ancient',
      'Modern',
    ]);
  });

  it('draws no timeline lanes when the source sets no lane-by', async () => {
    const svg = await renderEmbed(`timeline\n${TIMELINE_BODY}`);
    expect(laneAttrs(svg, 'tl-group-header', 'data-group')).toEqual([]);
  });
});
