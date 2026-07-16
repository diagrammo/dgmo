// quadrant-fill-outline.test.ts — §1.9 fill family on quadrant point dots.
//
// `fill-outline` hollows the data-point circles: theme base background fill so
// only the colored ring reads (the stroke already carries the quadrant color).
// The default treatment (white dot, colored ring) is unchanged, and
// `fill-solid` remains a no-op for quadrant dots.

import { describe, it, expect } from 'vitest';
import { renderQuadrant } from '../src/quadrant/renderer';
import { parseQuadrant } from '../src/quadrant/parser';
import { getPalette } from '../src/palettes';
import { themeBaseBg } from '../src/palettes/color-utils';

const PLAIN = `quadrant Crew Performance
x-label Low Skill, High Skill
y-label Low Loyalty, High Loyalty

top-right Promote green
bottom-right Watch Closely purple

Quartermaster 0.9 0.95
Spy 0.8 0.1
`;

const OUTLINED = PLAIN.replace('\n', '\nfill-outline\n');
const SOLID = PLAIN.replace('\n', '\nfill-solid\n');

const palette = getPalette('slate').light;
const bg = themeBaseBg(palette, false);

function renderDots(source: string): { fill: string; stroke: string }[] {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 800 });
  Object.defineProperty(container, 'clientHeight', { value: 600 });
  document.body.appendChild(container);
  renderQuadrant(container, parseQuadrant(source), palette, false);
  const dots = [...container.querySelectorAll('g.point-group circle')].map(
    (el) => ({
      fill: el.getAttribute('fill')!,
      stroke: el.getAttribute('stroke')!,
    })
  );
  container.remove();
  return dots;
}

describe('quadrant fill-outline point dots (§1.9)', () => {
  it('parses bare `fill-outline` into fillMode', () => {
    expect(parseQuadrant(OUTLINED).fillMode).toBe('outline');
    expect(parseQuadrant(PLAIN).fillMode).toBeUndefined();
  });

  it('fill-outline renders hollow dots: theme bg fill, colored stroke intact', () => {
    const baseDots = renderDots(PLAIN);
    const outlinedDots = renderDots(OUTLINED);
    expect(outlinedDots.length).toBe(baseDots.length);
    expect(outlinedDots.length).toBe(2);
    outlinedDots.forEach((dot, i) => {
      expect(dot.fill).toBe(bg);
      // Stroke still carries the quadrant color, unchanged from default.
      expect(dot.stroke).toBe(baseDots[i]!.stroke);
      expect(dot.stroke).not.toBe(bg);
    });
  });

  it('default and fill-solid dot rendering are unchanged (white fill)', () => {
    for (const source of [PLAIN, SOLID]) {
      const dots = renderDots(source);
      expect(dots.length).toBe(2);
      for (const dot of dots) {
        expect(dot.fill).toBe('#ffffff');
        expect(dot.stroke).not.toBe('#ffffff');
      }
    }
  });
});
