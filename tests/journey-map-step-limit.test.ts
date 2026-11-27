import { describe, it, expect } from 'vitest';
import { parseJourneyMap } from '../src/journey-map/parser';
import { JOURNEY_MAX_STEPS } from '../src/journey-map/limits';
import { getPalette } from '../src/palettes';

// #2448: past JOURNEY_MAX_STEPS the map draws the first N steps and raises one error.

const palette = getPalette('nord').light;
const PER_PHASE = 7;

function journeyWith(n: number): string {
  const lines = ['journey-map Long journey', ''];
  for (let i = 0; i < n; i++) {
    if (i % PER_PHASE === 0) lines.push(`[Phase ${i / PER_PHASE + 1}]`);
    lines.push(`  Step ${i + 1} score: ${(i % 5) + 1}`);
  }
  return lines.join('\n');
}

const tooMany = (src: string) =>
  parseJourneyMap(src, palette).diagnostics.filter(
    (d) => d.code === 'E_JOURNEY_TOO_MANY_STEPS'
  );
const stepsOf = (src: string) =>
  parseJourneyMap(src, palette).phases.flatMap((p) => p.steps);

describe('journey-map step limit (#2448)', () => {
  it('draws exactly JOURNEY_MAX_STEPS steps with no diagnostic', () => {
    const src = journeyWith(JOURNEY_MAX_STEPS);
    expect(stepsOf(src)).toHaveLength(JOURNEY_MAX_STEPS);
    expect(tooMany(src)).toHaveLength(0);
  });

  it('draws the first N of N+1 and raises one error on the first dropped step', () => {
    const src = journeyWith(JOURNEY_MAX_STEPS + 1);
    const steps = stepsOf(src);
    expect(steps).toHaveLength(JOURNEY_MAX_STEPS);
    expect(steps.at(-1)!.title).toBe(`Step ${JOURNEY_MAX_STEPS}`);
    const errs = tooMany(src);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.severity).toBe('error');
    expect(errs[0]!.message).toContain(`${JOURNEY_MAX_STEPS + 1} steps`);
    expect(errs[0]!.message).toContain(`first ${JOURNEY_MAX_STEPS}`);
    const lines = src.split('\n');
    expect(lines[errs[0]!.line - 1]!.trim()).toBe(
      `Step ${JOURNEY_MAX_STEPS + 1} score: ${(JOURNEY_MAX_STEPS % 5) + 1}`
    );
    expect(parseJourneyMap(src, palette).error).toBeNull();
  });

  it('300 steps in phases: keeps whole phases, a cut phase keeps its header, later phases go', () => {
    const parsed = parseJourneyMap(journeyWith(300), palette);
    const counts = parsed.phases.map((p) => p.steps.length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(JOURNEY_MAX_STEPS);
    expect(parsed.phases).toHaveLength(
      Math.ceil(JOURNEY_MAX_STEPS / PER_PHASE)
    );
    expect(counts.slice(0, -1).every((c) => c === PER_PHASE)).toBe(true);
    expect(tooMany(journeyWith(300))).toHaveLength(1);
    expect(tooMany(journeyWith(300))[0]!.message).toContain('300 steps');
  });

  it('caps flat (phaseless) journeys too', () => {
    const src = [
      'journey-map Flat',
      '',
      ...Array.from(
        { length: JOURNEY_MAX_STEPS + 4 },
        (_, i) => `Step ${i + 1} score: 3`
      ),
    ].join('\n');
    const parsed = parseJourneyMap(src, palette);
    expect(parsed.steps).toHaveLength(JOURNEY_MAX_STEPS);
    expect(tooMany(src)).toHaveLength(1);
  });
});
