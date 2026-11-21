import { describe, it, expect } from 'vitest';
import { parseSlope } from '../src/slope/parser';
import { renderSlopeChart } from '../src/slope/renderer';
import { getPalette } from '../src/palettes';
import '../src/palettes/index';

// #2119: a slope point past a fixed `y-axis` end becomes a triangle.
const draw = (axis: string) => {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800 });
  Object.defineProperty(host, 'clientHeight', { value: 500 });
  document.body.appendChild(host);
  renderSlopeChart(
    host,
    parseSlope(
      `slope Share\n${axis}\nperiod 2024 2025\n\nA 20 140\nB 40 -10\nC 30 35\n`
    ),
    getPalette('nord').light,
    false
  );
  const marks = [...host.querySelectorAll('path.dgmo-cut-mark')].map((p) =>
    p
      .getAttribute('d')!
      .slice(1, -1)
      .split('L')
      .map((q) => q.split(',').map(Number))
  );
  host.remove();
  return marks;
};

describe('slope cut mark (#2119)', () => {
  it('points past the range turn into up and down triangles', () => {
    const marks = draw('y-axis 0..100');
    expect(marks).toHaveLength(2);
    const ups = marks.filter((p) => p[2]![1]! < p[0]![1]!);
    expect(ups).toHaveLength(1);
  });

  it('draws none when every value is in range', () => {
    expect(draw('y-axis -50..200')).toHaveLength(0);
  });
});
