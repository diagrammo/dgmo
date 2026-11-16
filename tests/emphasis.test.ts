import { describe, it, expect } from 'vitest';
import {
  EMPHASIS_DIM_OPACITY,
  EMPHASIS_DIM_TEXT_OPACITY,
  isEmphasisToken,
  parseEmphasisDirective,
  resolveEmphasis,
} from '../src/utils/emphasis';
import { parseExtendedChart } from '../src/data-chart-parser';
import { renderDataChartD3 } from '../src/charts-d3';
import { getPalette } from '../src/palettes';
import { storyGround } from '../src/utils/emphasis';

// ── Spike scope note ──────────────────────────────────────────────────────
// §1.11 emphasis is prototyped on SANKEY ONLY. These tests pin the shared
// resolver (chart-type agnostic) plus the sankey wiring. Rollout to other
// chart types is a separate decision; do not read these as a rollout contract.

const FLOW = `sankey Rum Supply Chain

Sugar Plantations green
  Tortuga Distillery 3000
  Nassau Distillery 2500
Tortuga Distillery
  Barrel Aging 2000
  Spoilage 1000
`;

const ground = storyGround(getPalette('slate').light, false);

/** Names of the nodes drawn by `pred`, from the `<rect data-name>` marks. */
function nodeNames(svg: string, pred: (tag: string) => boolean): string[] {
  return (svg.match(/<rect[^>]*data-emph-key="node:[^>]*>/g) ?? [])
    .filter(pred)
    .map((t) => /data-name="([^"]*)"/.exec(t)![1]!)
    .sort();
}

function render(src: string): Promise<string> {
  return renderDataChartD3(src, 'light');
}

describe('emphasis directive parsing', () => {
  it('parses both duals', () => {
    expect(parseEmphasisDirective('highlight Revenue', 3)).toMatchObject({
      kind: 'highlight',
      names: ['Revenue'],
      lineNumber: 3,
    });
    expect(parseEmphasisDirective('dim Losses', 4)?.kind).toBe('dim');
  });

  it('treats comma as the authoritative list separator', () => {
    const d = parseEmphasisDirective('dim Ship Provisions, Spoilage', 1)!;
    expect(d.names).toEqual(['Ship Provisions', 'Spoilage']);
    expect(d.ambiguous).toBe(false);
  });

  it('reads a comma-less argument as ONE name, flagged ambiguous', () => {
    const d = parseEmphasisDirective('dim Ship Provisions', 1)!;
    expect(d.names).toEqual(['Ship Provisions']);
    expect(d.ambiguous).toBe(true);
    expect(d.raw).toBe('Ship Provisions');
  });

  it('rejects a bare token with no names', () => {
    expect(parseEmphasisDirective('dim', 1)).toBeNull();
    expect(parseEmphasisDirective('highlight   ', 1)).toBeNull();
  });

  it('recognizes its own tokens for parser escape hatches', () => {
    expect(isEmphasisToken('highlight')).toBe(true);
    expect(isEmphasisToken('DIM')).toBe(true);
    expect(isEmphasisToken('layout')).toBe(false);
  });
});

describe('emphasis resolution', () => {
  const names = ['Revenue', 'Losses', 'Ship Provisions'];

  it('dim recedes exactly what is named', () => {
    const d = parseEmphasisDirective('dim Losses', 1)!;
    expect([...resolveEmphasis(d, names).dimmed]).toEqual(['Losses']);
  });

  it('highlight recedes the complement', () => {
    const d = parseEmphasisDirective('highlight Revenue', 1)!;
    expect([...resolveEmphasis(d, names).dimmed].sort()).toEqual([
      'Losses',
      'Ship Provisions',
    ]);
  });

  it('matches case-insensitively and normalizes whitespace', () => {
    const d = parseEmphasisDirective('dim ship   provisions', 1)!;
    const r = resolveEmphasis(d, names);
    expect([...r.dimmed]).toEqual(['Ship Provisions']);
    expect(r.unknown).toEqual([]);
  });

  it('resolves a multi-word name without requiring a comma', () => {
    const d = parseEmphasisDirective('dim Ship Provisions', 1)!;
    expect([...resolveEmphasis(d, names).dimmed]).toEqual(['Ship Provisions']);
  });

  it('falls back to token-splitting when the whole phrase misses', () => {
    const d = parseEmphasisDirective('dim Revenue Losses', 1)!;
    const r = resolveEmphasis(d, names);
    expect([...r.dimmed].sort()).toEqual(['Losses', 'Revenue']);
    expect(r.unknown).toEqual([]);
  });

  it('reports unknown names but still applies the hits', () => {
    const d = parseEmphasisDirective('dim Losses, Ghost', 1)!;
    const r = resolveEmphasis(d, names);
    expect([...r.dimmed]).toEqual(['Losses']);
    expect(r.unknown).toEqual(['Ghost']);
  });

  it('degrades an all-miss highlight to NOTHING dimmed, never everything', () => {
    const d = parseEmphasisDirective('highlight Ghost', 1)!;
    const r = resolveEmphasis(d, names);
    expect(r.dimmed.size).toBe(0);
    expect(r.unknown).toEqual(['Ghost']);
  });

  it('is a no-op when absent', () => {
    expect(resolveEmphasis(undefined, names).dimmed.size).toBe(0);
  });
});

describe('sankey parser wiring', () => {
  it('does not create a phantom node from the directive line', () => {
    const parsed = parseExtendedChart(`${FLOW}dim Spoilage\n`);
    const nodes = new Set(
      (parsed.links ?? []).flatMap((l) => [l.source, l.target])
    );
    expect(nodes.has('dim Spoilage')).toBe(false);
    expect(nodes.has('Spoilage')).toBe(true);
    expect(parsed.emphasis).toMatchObject({
      kind: 'dim',
      names: ['Spoilage'],
    });
  });

  it('is last-one-wins across the family, like fill-*', () => {
    const parsed = parseExtendedChart(
      `${FLOW}dim Spoilage\nhighlight Barrel Aging\n`
    );
    expect(parsed.emphasis?.kind).toBe('highlight');
    expect(parsed.emphasis?.names).toEqual(['Barrel Aging']);
  });

  it('leaves the links themselves untouched', () => {
    const plain = parseExtendedChart(FLOW);
    const emph = parseExtendedChart(`${FLOW}dim Spoilage\n`);
    expect(emph.links?.length).toBe(plain.links?.length);
  });
});

describe('sankey render output', async () => {
  it('bakes no dim attributes without the directive', async () => {
    const svg = await render(FLOW);
    expect(svg).not.toContain(`opacity="${EMPHASIS_DIM_OPACITY}"`);
    // baseline ribbon translucency is still present
    expect(svg).toContain('fill-opacity="0.6"');
  });

  it('dims the named node and its flows', async () => {
    const svg = await render(`${FLOW}dim Spoilage\n`);
    expect(svg).toContain(`opacity="${EMPHASIS_DIM_OPACITY}"`);
    expect(svg).toContain(`opacity="${EMPHASIS_DIM_TEXT_OPACITY}"`);
  });

  it('MULTIPLIES the ribbon baseline rather than replacing it', async () => {
    const svg = await render(`${FLOW}dim Spoilage\n`);
    const dimmedRibbon = 0.6 * EMPHASIS_DIM_OPACITY;
    expect(svg).toContain(`fill-opacity="${dimmedRibbon}"`);
    // a dimmed ribbon must never end up MORE opaque than an undimmed one
    expect(dimmedRibbon).toBeLessThan(0.6);
    // undimmed flows keep the baseline
    expect(svg).toContain('fill-opacity="0.6"');
  });

  it('highlight lights the flow closure, not just the named node', async () => {
    // `Barrel Aging` is fed by Tortuga, which is fed by Sugar Plantations.
    // All three must stay lit — greying a highlighted node's own inflows
    // would delete the explanation the highlight exists to give.
    const svg = await render(`${FLOW}highlight Barrel Aging\n`);
    const litRibbons = svg.split('fill-opacity="0.6"').length - 1;
    expect(litRibbons).toBeGreaterThan(0);
    // ...but the off-path Spoilage branch DOES recede: grey ribbons, no opacity.
    expect(svg).toContain(`fill="${ground.groundStroke}" fill-opacity="0.6"`);
    expect(svg).not.toContain(`opacity="${EMPHASIS_DIM_OPACITY}"`);
    expect(
      nodeNames(svg, (t) => t.includes(`fill="${ground.groundFill}"`))
    ).toContain('Spoilage');
  });

  it('highlight does not leak sideways into unrelated siblings', async () => {
    // A naive bidirectional closure walks UP to Tortuga then back DOWN into
    // Spoilage, lighting the whole connected component and greying nothing.
    // Barrel Aging's real closure is {Sugar, Tortuga, Barrel Aging}, so the
    // off-path Nassau and Spoilage both recede — exactly two.
    const svg = await render(`${FLOW}highlight Barrel Aging\n`);
    const greyNodes = nodeNames(svg, (t) =>
      t.includes(`fill="${ground.groundFill}"`)
    );
    expect(greyNodes).toEqual(['Nassau Distillery', 'Spoilage']);
    // Their inflow ribbons recede with them: one each.
    const greyRibbons =
      svg.split(`fill="${ground.groundStroke}" fill-opacity="0.6"`).length - 1;
    expect(greyRibbons).toBe(2);
  });

  it('the duals recede the same set of elements', async () => {
    // `highlight Barrel Aging` recedes Nassau + Spoilage by ground paint;
    // naming those two explicitly with `dim` recedes the same nodes by opacity.
    const viaHighlight = await render(`${FLOW}highlight Barrel Aging\n`);
    const viaDim = await render(`${FLOW}dim Spoilage, Nassau Distillery\n`);
    expect(
      nodeNames(viaHighlight, (t) => t.includes(`fill="${ground.groundFill}"`))
    ).toEqual(
      nodeNames(viaDim, (t) => t.includes(`opacity="${EMPHASIS_DIM_OPACITY}"`))
    );
    // Dim keeps the old contract: baked opacity, no ground paint.
    expect(viaDim).not.toContain(ground.groundFill);
  });

  it('a trailing colour word paints the lit nodes with that palette colour', async () => {
    const svg = await render(`${FLOW}highlight Barrel Aging orange\n`);
    const lit = nodeNames(svg, (t) =>
      t.includes(`fill="${getPalette('slate').light.colors.orange}"`)
    );
    expect(lit).toContain('Barrel Aging');
  });

  it('preserves hue — dimming is opacity, never a color substitution', async () => {
    const plain = await render(FLOW);
    const dimmedSvg = await render(`${FLOW}dim Spoilage\n`);
    // the green source node's resolved fill still appears in the dimmed render
    const greenFill = plain.match(/fill="(#[0-9a-f]{6})"/i)?.[1];
    expect(greenFill).toBeTruthy();
    expect(dimmedSvg).toContain(greenFill!);
  });

  it('is static — no CSS class or script dependency in the export', async () => {
    const svg = await render(`${FLOW}dim Spoilage\n`);
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('dgmo-dim');
  });

  it('an unknown name renders the chart undimmed', async () => {
    const svg = await render(`${FLOW}dim Ghost\n`);
    expect(svg).not.toContain(`opacity="${EMPHASIS_DIM_OPACITY}"`);
  });
});
