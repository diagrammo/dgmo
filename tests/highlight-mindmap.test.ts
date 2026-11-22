// `highlight` on mindmap (#2041): a name lights that node and its whole
// subtree; a chain lights exactly its path. Everything else takes the ground.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { render } from '../src/render';
import { parseDgmo } from '../src/dgmo-router';
import { parseMindmap } from '../src/mindmap/parser';
import { getPalette } from '../src/palettes';
import { storyGround } from '../src/utils/emphasis';

const ground = storyGround(getPalette('slate').light, false);

const SRC = `mindmap Plan

Scope
  Core
  Extras
Readiness
  Load testing
  Rollback`;

async function draw(src: string): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  host.innerHTML = (await render(src, { theme: 'light' })).svg;
  return host;
}

function nodes(
  host: HTMLElement
): Record<string, [string | null, string | null]> {
  const out: Record<string, [string | null, string | null]> = {};
  for (const g of host.querySelectorAll('g.mindmap-node')) {
    const t = g.querySelector('text')!;
    // A two-sided leaf paints no card (#2100); its dot is the mark, and a
    // receded dot takes the ground stroke. Report it as the card would be.
    const dot = g.querySelector('circle.mindmap-leaf-dot');
    const paint = dot
      ? dot.getAttribute('fill') === ground.groundStroke
        ? ground.groundFill
        : dot.getAttribute('fill')
      : g.querySelector('rect')!.getAttribute('fill');
    out[t.textContent!] = [paint, t.getAttribute('fill')];
  }
  return out;
}

function edges(host: HTMLElement): (string | null)[] {
  return [...host.querySelectorAll('path.mindmap-edge')].map((e) =>
    e.getAttribute('stroke')
  );
}

describe('highlight on mindmap', () => {
  it('lights a branch and recedes the rest', async () => {
    const plain = nodes(await draw(SRC));
    const lit = nodes(await draw(`${SRC}\nhighlight Readiness`));
    expect(lit['Readiness']).toEqual(plain['Readiness']);
    expect(lit['Rollback']).toEqual(plain['Rollback']);
    expect(lit['Scope']![0]).toBe(ground.groundFill);
    expect(lit['Scope']![1]).toBe(ground.groundText);
    expect(lit['Core']![0]).toBe(ground.groundFill);
    expect(lit['Plan']![0]).toBe(ground.groundFill);
  });

  it('a branch keeps its own edges and recedes the others', async () => {
    const e = edges(await draw(`${SRC}\nhighlight Readiness`));
    const lit = e.filter((s) => s !== ground.groundStroke).length;
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(e.length);
  });

  it('a chain lights exactly its path', async () => {
    const host = await draw(
      `${SRC}\nhighlight Plan -> Readiness -> Load testing`
    );
    const n = nodes(host);
    expect(n['Rollback']![0]).toBe(ground.groundFill);
    expect(n['Load testing']![0]).not.toBe(ground.groundFill);
    expect(n['Plan']![0]).not.toBe(ground.groundFill);
    const e = edges(host);
    const lit = e.filter((s) => s !== ground.groundStroke).length;
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(e.length);
  });

  it('warns on a missing link and recedes nothing', async () => {
    const src = `${SRC}\nhighlight Plan -> Core`;
    const diags = parseMindmap(src).diagnostics;
    expect(diags.map((d) => d.message)).toEqual([
      'highlight names a link this diagram does not have: Plan -> Core',
    ]);
    expect(diags[0]!.severity).toBe('warning');
    expect((await draw(src)).innerHTML).not.toContain(ground.groundFill);
  });

  it('is not read as content', () => {
    const p = parseMindmap(`${SRC}\nhighlight Scope`);
    expect(p.diagnostics).toEqual([]);
    expect(JSON.stringify(p.roots)).not.toContain('highlight');
  });

  it('paints no ground without a highlight line', async () => {
    const svg = (await draw(SRC)).innerHTML;
    expect(svg).not.toContain(ground.groundFill);
    expect(svg).not.toContain(ground.groundStroke);
  });

  it('the fixture parses with no warnings and recedes', async () => {
    const src = readFileSync('gallery/fixtures/mindmap-highlight.dgmo', 'utf8');
    expect(
      parseDgmo(src).diagnostics.filter((d) => d.severity === 'warning')
    ).toEqual([]);
    expect((await draw(src)).innerHTML).toContain(ground.groundFill);
  });
});
