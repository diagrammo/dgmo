import { describe, it, expect } from 'vitest';
import { renderForExport } from '../src/d3';
import { ARROWHEAD_WIDTH } from '../src/utils/visual-conventions';

// Every edge, arrowhead and label lies inside the canvas, even where a dense
// graph routes edges around the outside of its node columns (#2436).

const N = 12;
const names = Array.from({ length: N }, (_, i) => `N${i + 1}`);

function complete(header: string, node: (n: string) => string, label = false) {
  const lines = [header];
  for (const a of names)
    for (const b of names)
      if (a !== b)
        lines.push(
          label
            ? `${node(a)} -${a}${b}-> ${node(b)}`
            : `${node(a)} -> ${node(b)}`
        );
  return lines.join('\n');
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function check(svg: string): { paths: number; labels: number } {
  // The export fit may trim the viewBox to the content, never past it.
  const vb =
    /<svg[^>]*viewBox="([-\d.e]+) ([-\d.e]+) ([\d.e]+) ([\d.e]+)"/.exec(svg);
  expect(vb).not.toBeNull();
  const [X0, Y0, W, H] = vb!.slice(1, 5).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const tf =
    /<g transform="translate\(([-\d.e]+),\s*([-\d.e]+)\) scale\(([-\d.e]+)\)"/.exec(
      svg
    );
  expect(tf).not.toBeNull();
  const [tx, ty, s] = [Number(tf![1]), Number(tf![2]), Number(tf![3])];
  const inside = (b: Box) => {
    expect(tx + s * b.minX).toBeGreaterThanOrEqual(X0);
    expect(ty + s * b.minY).toBeGreaterThanOrEqual(Y0);
    expect(tx + s * b.maxX).toBeLessThanOrEqual(X0 + W);
    expect(ty + s * b.maxY).toBeLessThanOrEqual(Y0 + H);
  };
  let paths = 0;
  for (const m of svg.matchAll(
    /<path d="([^"]+)"[^>]*class="(?:fc|st)-edge"/g
  )) {
    const nums = (m[1]!.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    // The arrowhead ends at the path's last point; pad by its length.
    const pad = ARROWHEAD_WIDTH;
    inside({
      minX: Math.min(...xs) - pad,
      minY: Math.min(...ys) - pad,
      maxX: Math.max(...xs) + pad,
      maxY: Math.max(...ys) + pad,
    });
    paths++;
  }
  let labels = 0;
  for (const m of svg.matchAll(
    /<rect x="([-\d.e]+)" y="([-\d.e]+)" width="([\d.e]+)" height="([\d.e]+)"[^>]*class="(?:fc|st)-edge-label-bg"/g
  )) {
    const [x, y, w, h] = m.slice(1, 5).map(Number) as [
      number,
      number,
      number,
      number,
    ];
    inside({ minX: x, minY: y, maxX: x + w, maxY: y + h });
    labels++;
  }
  return { paths, labels };
}

describe('canvas bounds over a dense graph (#2436)', () => {
  it('a 12-node complete flowchart draws every edge inside the svg', async () => {
    const svg = await renderForExport(
      complete('flowchart Dense', (n) => `[${n}]`),
      'light'
    );
    expect(check(svg).paths).toBe(N * (N - 1));
  });

  it('a 12-node complete flowchart keeps every edge label inside the svg', async () => {
    const svg = await renderForExport(
      complete('flowchart Dense', (n) => `[${n}]`, true),
      'light'
    );
    const { paths, labels } = check(svg);
    expect(paths).toBe(N * (N - 1));
    expect(labels).toBe(N * (N - 1));
  });

  it('a 12-node complete state diagram draws every edge inside the svg', async () => {
    const svg = await renderForExport(
      complete('state Dense', (n) => n),
      'light'
    );
    expect(check(svg).paths).toBe(N * (N - 1));
  });
});
