import { describe, it, expect } from 'vitest';
import { parseCycle } from '../src/cycle/parser';
import { CYCLE_MAX_STEPS, MIN_ARC_ANGLE } from '../src/cycle/limits';
import { getDiagnosticSpec } from '../src/diagnostics-registry';
import { renderForExport } from '../src/d3';
import { validateDiagram } from '../src/validate-diagram';

const cycleOf = (n: number, header = 'cycle Steps') =>
  `${header}\n\n` +
  Array.from({ length: n }, (_, i) => `Step ${i + 1}`).join('\n');

describe('cycle — the step limit (#2430)', () => {
  it('is the ring filled at the least arc a step keeps', () => {
    expect(CYCLE_MAX_STEPS).toBe(Math.floor((2 * Math.PI) / MIN_ARC_ANGLE));
    expect(CYCLE_MAX_STEPS).toBe(24);
  });

  it('draws a cycle at the limit with no diagnostic', async () => {
    const parsed = parseCycle(cycleOf(CYCLE_MAX_STEPS));
    expect(parsed.error).toBeNull();
    expect(parsed.diagnostics).toEqual([]);
    const svg = await renderForExport(cycleOf(CYCLE_MAX_STEPS), 'light');
    expect(svg).toContain('cycle-node');
  });

  it('refuses one step past the limit, on that step', async () => {
    const parsed = parseCycle(cycleOf(CYCLE_MAX_STEPS + 1));
    expect(parsed.error).not.toBeNull();
    const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('E_CYCLE_TOO_MANY_STEPS');
    // Line 1 is the header, line 2 blank, steps from line 3.
    expect(errors[0]!.line).toBe(3 + CYCLE_MAX_STEPS);
    expect(errors[0]!.message).toBe(
      `This cycle has ${CYCLE_MAX_STEPS + 1} steps; a cycle can show at most ${CYCLE_MAX_STEPS}. Group steps into phases, or use a flowchart.`
    );
    expect(await renderForExport(cycleOf(CYCLE_MAX_STEPS + 1), 'light')).toBe(
      ''
    );
  });

  it('refuses the 60- and 200-step pressure files', async () => {
    const sixty = cycleOf(60, 'cycle Sixty');
    const twoHundred = cycleOf(200, 'cycle Big\ncircle-nodes\nautonumber');
    for (const [src, n] of [
      [sixty, 60],
      [twoHundred, 200],
    ] as const) {
      const parsed = parseCycle(src);
      expect(parsed.diagnostics.map((d) => d.code)).toEqual([
        'E_CYCLE_TOO_MANY_STEPS',
      ]);
      expect(parsed.diagnostics[0]!.message).toContain(
        `This cycle has ${n} steps`
      );
      expect(await renderForExport(src, 'light')).toBe('');
    }
  });

  it('reaches the validate path (MCP validate_diagram, CLI --json)', () => {
    const v = validateDiagram(cycleOf(200, 'cycle Big'));
    expect(v.errors.map((e) => e.code)).toEqual(['E_CYCLE_TOO_MANY_STEPS']);
    expect(validateDiagram(cycleOf(CYCLE_MAX_STEPS)).errors).toEqual([]);
  });

  it('is registered', () => {
    expect(getDiagnosticSpec('E_CYCLE_TOO_MANY_STEPS')?.severity).toBe('error');
  });
});
