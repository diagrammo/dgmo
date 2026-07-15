import { describe, it, expect } from 'vitest';
import { render } from '../src/render';

// Cross-cutting `fill-solid` directive (§1): every chart type with a tinted
// node/mark fill surface must honor it (full intent saturation instead of the
// canonical muted tint). These cases lock in the wiring for the types that
// gained support — a regression that silently drops the directive makes the
// fill-solid render identical to the default, which this suite catches.
//
// The fixtures all carry a colored fill, so honoring fill-solid necessarily
// changes the emitted `fill` attributes; the only source difference is the
// directive itself, so SVG inequality is a precise proof of end-to-end wiring.

const CASES: Record<string, string> = {
  pert: `pert
time-unit w

A 1 2 3
  -> B
B 2 3 4`,
  block: `block System

tag Layer as l
  Edge blue

[Clients] l: Edge
  [Web] [Mobile]`,
  swimlane: `swimlane Weekly

lane Writer gray
lane Editor blue

Writer
  Draft Post
Editor
  Review`,
  treemap: `treemap Budget

Engineering
  Platform 320
  Mobile 180`,
  heatmap: `heatmap
columns Mon, Tue
Row1 5 8`,
  venn: `venn
Swordsmanship as sw
Navigation as nav
sw + nav Overlap`,
  // Area line: fill-solid makes the area under the line opaque (not 25% tint).
  line: `line Treasure Hauled
fill
Jan 10
Feb 40
Mar 25`,
  // Event-line: fill-solid saturates the card fill (and the no-box shelf).
  'event-line': `event-line Voyage
tag Landfall as l

Set Sail l 1701-03
  Left port at dawn
Made Landfall l 1701-09
  Sighted the coast`,
};

function withSolidFill(src: string): string {
  // Insert the directive on the line after the chart-type header so it lands
  // in the diagram-level option block for every type.
  const lines = src.split('\n');
  lines.splice(1, 0, 'fill-solid');
  return lines.join('\n');
}

describe('fill-solid directive — cross-type consistency', () => {
  for (const [type, src] of Object.entries(CASES)) {
    it(`${type} parses cleanly and honors fill-solid`, async () => {
      const base = await render(src);
      const solid = await render(withSolidFill(src));

      // Both render without error diagnostics (fixtures are valid DGMO).
      const errs = (d: typeof base.diagnostics) =>
        d.filter((x) => x.severity === 'error');
      expect(errs(base.diagnostics)).toEqual([]);
      expect(errs(solid.diagnostics)).toEqual([]);

      expect(base.svg).toContain('<svg');
      expect(solid.svg).toContain('<svg');

      // fill-solid must change the rendered fills — otherwise the directive
      // is being parsed-but-ignored (the inconsistency this suite guards).
      expect(solid.svg).not.toBe(base.svg);
    });
  }
});
