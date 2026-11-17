/**
 * W_TYPE_BELOW_MINIMUM (#1844): a wide sequence or flowchart warns when, at a
 * stated width, its type would be drawn under 11px. Warning only.
 */
import { describe, it, expect } from 'vitest';
import { render } from '../src/render';

const wide = (n: number) => {
  let s = 'sequence Big\n';
  for (let i = 1; i < n; i++)
    s += `Participant${i} -call step ${i}-> Participant${i + 1}\n`;
  return s;
};
const wideFlow = (n: number) => {
  let s = 'flowchart Big\ndirection-lr\n';
  for (let i = 1; i < n; i++) s += `[Node ${i}] -> [Node ${i + 1}]\n`;
  return s;
};
const hits = (ds: { code?: string }[]) =>
  ds.filter((d) => d.code === 'W_TYPE_BELOW_MINIMUM');

describe('minimum type size', () => {
  it('warns for a 14-participant sequence at 1200px', async () => {
    const { diagnostics } = await render(wide(14), { width: 1200 });
    expect(hits(diagnostics)).toHaveLength(1);
  });

  it('warns for a 28-node left-to-right flowchart at 1200px', async () => {
    const { diagnostics } = await render(wideFlow(28), { width: 1200 });
    expect(hits(diagnostics)).toHaveLength(1);
  });

  it('is silent with no stated width', async () => {
    const { diagnostics } = await render(wide(14));
    expect(hits(diagnostics)).toHaveLength(0);
  });

  it('is silent for a small diagram', async () => {
    const { diagnostics } = await render(wide(3), { width: 1200 });
    expect(hits(diagnostics)).toHaveLength(0);
  });
});
