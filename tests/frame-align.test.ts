// Frame alignment and the static key's frame (#1838).
import { describe, it, expect } from 'vitest';
import {
  frameAlign,
  parseChartFrameLine,
  type ChartFrame,
} from '../src/utils/chart-frame-parse';
import type { DgmoError } from '../src/diagnostics';
import { render } from '../src/render';

const exportSvg = async (src: string) => (await render(src)).svg;
import { parseGoal } from '../src/goal/parser';

function parse(lines: string[], opts: { heroTitle?: string } = {}) {
  const holder: { frame?: ChartFrame } = {};
  const diagnostics: DgmoError[] = [];
  lines.forEach((l, i) =>
    expect(parseChartFrameLine(holder, l, i + 1, diagnostics, opts), l).toBe(
      true
    )
  );
  return { frame: holder.frame, diagnostics };
}

describe('frame alignment — parse', () => {
  it('defaults every part to left', () => {
    for (const part of ['title', 'subtitle', 'legend', 'footer'] as const)
      expect(frameAlign(undefined, part)).toBe('left');
  });

  it('lets align set every part and a part override it', () => {
    const { frame } = parse(['align center', 'legend-align right']);
    expect(frameAlign(frame, 'title')).toBe('center');
    expect(frameAlign(frame, 'subtitle')).toBe('center');
    expect(frameAlign(frame, 'footer')).toBe('center');
    expect(frameAlign(frame, 'legend')).toBe('right');
  });

  it('puts the subtitle under the title unless told otherwise', () => {
    expect(frameAlign(parse(['title-align right']).frame, 'subtitle')).toBe(
      'right'
    );
    expect(
      frameAlign(
        parse(['title-align right', 'subtitle-align left']).frame,
        'subtitle'
      )
    ).toBe('left');
  });

  it('warns and ignores a value it cannot read', () => {
    for (const bad of ['align middle', 'title-align', 'footer-align 3']) {
      const { frame, diagnostics } = parse([bad]);
      expect(frame?.align, bad).toBeUndefined();
      expect(diagnostics[0]?.severity, bad).toBe('warning');
      expect(diagnostics[0]?.message, bad).toMatch(/left, center or right/);
    }
  });

  it('reads legend-box and legend-pill, last one winning', () => {
    expect(parse(['legend-box']).frame?.legendStyle).toBe('box');
    expect(parse(['legend-box', 'legend-pill']).frame?.legendStyle).toBe(
      'pill'
    );
  });

  it('warns on a hero title and keeps the other parts', () => {
    const { frame, diagnostics } = parse(
      ['align center', 'title-align right', 'footer-align right'],
      { heroTitle: 'Goal' }
    );
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]!.message).toMatch(/Goal keeps its own large title/);
    expect(frameAlign(frame, 'title')).toBe('left');
    expect(frameAlign(frame, 'footer')).toBe('right');
  });

  it('reaches a hero parser', () => {
    const r = parseGoal('goal Savings\nalign center\nRaised 40 of 100');
    expect(
      r.diagnostics.some((d) => /keeps its own large title/.test(d.message))
    ).toBe(true);
  });
});

describe('legend key frame — render', () => {
  const PIE = `bar Support Tickets by Priority
x-label Month
y-label Tickets

stack
  Critical red
  High orange
  Medium yellow
  Low green
  Info blue

January 8 24 45 62 31
February 12 19 51 58 28
March 6 22 38 71 35
April 10 28 42 65 40
May 5 15 48 70 33`;
  const ORG = `org Crew

tag Watch alias w
  Larboard
  Starboard

Captain
  Mate | w: Larboard
  Bosun | w: Starboard`;

  it('draws a bare key by default', async () => {
    for (const src of [PIE, ORG]) {
      const svg = await exportSvg(src);
      expect(svg).not.toMatch(/dgmo-legend-key-(box|pill)/);
    }
  });

  it('draws the box or the pill when asked', async () => {
    for (const src of [PIE, ORG]) {
      const [head, ...rest] = src.split('\n');
      const box = await exportSvg([head, 'legend-box', ...rest].join('\n'));
      const pill = await exportSvg([head, 'legend-pill', ...rest].join('\n'));
      expect(box, head).toContain('dgmo-legend-key-box');
      expect(pill, head).toContain('dgmo-legend-key-pill');
    }
  });
});
