// `highlight` on org (#2041): a name lights that person or team and its whole
// subtree; a chain lights exactly its path. Everything else takes the ground.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { render } from '../src/render';
import { parseDgmo } from '../src/dgmo-router';
import { parseOrg } from '../src/org/parser';
import { getPalette } from '../src/palettes';
import { storyGround } from '../src/utils/emphasis';

const ground = storyGround(getPalette('slate').light, false);

const SRC = `org Company

CEO
  CTO
    Platform
    Mobile
  CFO
    Accounting`;

async function draw(src: string): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  host.innerHTML = (await render(src, { theme: 'light' })).svg;
  return host;
}

function cards(host: HTMLElement): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const g of host.querySelectorAll('g.org-node')) {
    const label = g.querySelector('text')!.textContent!;
    out[label] = g.querySelector('rect')!.getAttribute('fill');
  }
  return out;
}

function edgeStrokes(host: HTMLElement): Record<string, string | null> {
  const nodes = new Map<string, string>();
  for (const g of host.querySelectorAll('g.org-node'))
    nodes.set(
      g.getAttribute('data-node-id')!,
      g.querySelector('text')!.textContent!
    );
  const out: Record<string, string | null> = {};
  for (const e of host.querySelectorAll('path.org-edge'))
    out[
      `${nodes.get(e.getAttribute('data-from')!)}>${nodes.get(e.getAttribute('data-to')!)}`
    ] = e.getAttribute('stroke');
  return out;
}

describe('highlight on org', () => {
  it('lights a branch and recedes the rest', async () => {
    const plain = cards(await draw(SRC));
    const lit = cards(await draw(`${SRC}\nhighlight CTO`));
    expect(lit['CTO']).toBe(plain['CTO']);
    expect(lit['Platform']).toBe(plain['Platform']);
    expect(lit['Mobile']).toBe(plain['Mobile']);
    expect(lit['CEO']).toBe(ground.groundFill);
    expect(lit['CFO']).toBe(ground.groundFill);
    expect(lit['Accounting']).toBe(ground.groundFill);
  });

  it('lights the branch edges and recedes the others', async () => {
    const e = edgeStrokes(await draw(`${SRC}\nhighlight CTO`));
    expect(e['CTO>Platform']).not.toBe(ground.groundStroke);
    expect(e['CEO>CTO']).toBe(ground.groundStroke);
    expect(e['CFO>Accounting']).toBe(ground.groundStroke);
  });

  it('a chain lights exactly its path', async () => {
    const host = await draw(`${SRC}\nhighlight CEO -> CTO -> Platform`);
    const c = cards(host);
    const e = edgeStrokes(host);
    expect(c['Mobile']).toBe(ground.groundFill);
    expect(c['Platform']).not.toBe(ground.groundFill);
    expect(e['CEO>CTO']).not.toBe(ground.groundStroke);
    expect(e['CTO>Platform']).not.toBe(ground.groundStroke);
    expect(e['CTO>Mobile']).toBe(ground.groundStroke);
  });

  it('warns on a missing link and recedes nothing', async () => {
    const src = `${SRC}\nhighlight CEO -> Platform`;
    const diags = parseOrg(src).diagnostics;
    expect(diags.map((d) => d.message)).toEqual([
      'highlight names a link this diagram does not have: CEO -> Platform',
    ]);
    expect(diags[0]!.severity).toBe('warning');
    const svg = (await draw(src)).innerHTML;
    expect(svg).not.toContain(ground.groundFill);
  });

  it('is not read as content', () => {
    const p = parseOrg(`${SRC}\nhighlight CTO`);
    expect(p.diagnostics).toEqual([]);
    expect(JSON.stringify(p.roots)).not.toContain('highlight');
  });

  it('paints no ground without a highlight line', async () => {
    const svg = (await draw(SRC)).innerHTML;
    expect(svg).not.toContain(ground.groundFill);
    expect(svg).not.toContain(ground.groundStroke);
  });

  it('keeps a lit collapsed branch lit', async () => {
    const host = await draw(
      `org Company\n\nCEO\n  CTO collapsed: true\n    Platform\n  CFO\n\nhighlight CTO`
    );
    const c = cards(host);
    expect(c['CTO']).not.toBe(ground.groundFill);
    expect(c['CFO']).toBe(ground.groundFill);
  });

  it('the fixture parses with no warnings and recedes', async () => {
    const src = readFileSync('gallery/fixtures/org-highlight.dgmo', 'utf8');
    expect(
      parseDgmo(src).diagnostics.filter((d) => d.severity === 'warning')
    ).toEqual([]);
    expect(await draw(src)).toBeTruthy();
  });
});
