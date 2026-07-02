import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

import { render } from '../src/render';
import { normalizeSvgForEmbed } from '../src/utils/svg-embed';

/**
 * Embed clipping regression gate.
 *
 * Every doc-site wrapper (astro/docusaurus/fumadocs via remark-dgmo) and the
 * Obsidian plugin embed diagrams by running the renderer's SVG through
 * `normalizeSvgForEmbed`, which tightens the root `viewBox` to the content.
 * When that tightening misfires it SHIFTS or COLLAPSES the frame and the
 * diagram gets cut off in the host — historically word-cloud (collapse),
 * arc-path charts (over-shoot shift-clip), and start-anchored text (undercount).
 *
 * The renderers self-size their own `viewBox` to bound all content correctly,
 * so the invariant that guarantees "nothing is cut off after normalization" is:
 *
 *   the final embed viewBox must stay WITHIN the renderer's canvas (±tol)
 *   AND must not collapse to a fragment of it.
 *
 * This asserts that invariant across every shipped example so a new chart type,
 * a renderer change, or a weakened guard can't silently start clipping embeds —
 * no manual spot-checking of Obsidian / doc-site plugins required.
 */

// dgmo repo lives beside dgmo-content in the workspace.
const EXAMPLES_DIR = resolve(__dirname, '../../dgmo-content/examples');

function parseViewBox(
  svg: string
): { x: number; y: number; width: number; height: number } | null {
  const m = svg.match(/<svg[^>]*?\bviewBox="([^"]+)"/);
  if (!m) return null;
  const n = m[1]!
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    n.length !== 4 ||
    n.some((v) => !Number.isFinite(v)) ||
    n[2]! <= 0 ||
    n[3]! <= 0
  )
    return null;
  return { x: n[0]!, y: n[1]!, width: n[2]!, height: n[3]! };
}

const exampleFiles = readdirSync(EXAMPLES_DIR, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith('.dgmo'))
  .sort();

// Guard-derived bounds: the trust guard allows the tightened box to sit at most
// TOL outside the canvas, and only trusts a trim that covers >= 50% per axis.
const TOL = 2.5;
const MIN_COVERAGE = 0.45;

describe('embed clipping regression (all shipped examples)', () => {
  it('found the example corpus', () => {
    // Fail loudly if the workspace layout moved rather than silently testing 0.
    expect(exampleFiles.length).toBeGreaterThan(50);
  });

  it.each(exampleFiles)('%s embeds without clipping', async (rel) => {
    const source = readFileSync(resolve(EXAMPLES_DIR, rel), 'utf-8');
    const { svg } = await render(source, { theme: 'light' });

    // A shipped example must actually render.
    expect(svg, `${rel} produced empty SVG`).not.toBe('');

    const canvas = parseViewBox(svg);
    expect(canvas, `${rel} renderer SVG has no usable viewBox`).not.toBeNull();

    const embed = parseViewBox(normalizeSvgForEmbed(svg));
    expect(embed, `${rel} embed SVG has no usable viewBox`).not.toBeNull();

    const c = canvas!;
    const e = embed!;

    // (1) Within canvas — the frame never shifts off the diagram.
    expect(e.x, `${rel}: embed left escapes canvas`).toBeGreaterThanOrEqual(
      c.x - TOL
    );
    expect(e.y, `${rel}: embed top escapes canvas`).toBeGreaterThanOrEqual(
      c.y - TOL
    );
    expect(
      e.x + e.width,
      `${rel}: embed right escapes canvas`
    ).toBeLessThanOrEqual(c.x + c.width + TOL);
    expect(
      e.y + e.height,
      `${rel}: embed bottom escapes canvas`
    ).toBeLessThanOrEqual(c.y + c.height + TOL);

    // (2) Not collapsed — the frame never zooms into a fragment.
    expect(
      e.width / c.width,
      `${rel}: embed width collapsed to a fragment of the canvas`
    ).toBeGreaterThanOrEqual(MIN_COVERAGE);
    expect(
      e.height / c.height,
      `${rel}: embed height collapsed to a fragment of the canvas`
    ).toBeGreaterThanOrEqual(MIN_COVERAGE);
  });
});
