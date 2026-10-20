import { describe, it, expect } from 'vitest';
import { lintSvg, parseTransform } from './stress/lint';

const svg = (body: string, w = 200, h = 100) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;

const rules = (s: string) => lintSvg(s).map((f) => f.rule);

describe('stress geometry lints', () => {
  it('passes clean text inside the canvas', () => {
    expect(
      lintSvg(svg('<text x="10" y="20" font-size="12">Hello</text>'))
    ).toEqual([]);
  });

  it('flags text past the canvas edge, honouring text-anchor', () => {
    expect(
      rules(svg('<text x="190" y="20" font-size="12">A long label</text>'))
    ).toEqual(['text-outside']);
    expect(
      rules(
        svg(
          '<text x="190" y="20" font-size="12" text-anchor="end">A long label</text>'
        )
      )
    ).toEqual([]);
  });

  it('applies ancestor transforms before checking the canvas', () => {
    expect(
      rules(
        svg(
          '<g transform="translate(300,0)"><text x="0" y="20" font-size="12">Hi</text></g>'
        )
      )
    ).toEqual(['text-outside']);
    expect(
      rules(
        svg(
          '<g transform="translate(-50,0)"><text x="60" y="20" font-size="12">Hi</text></g>'
        )
      )
    ).toEqual([]);
  });

  it('flags two labels drawn over each other, not a halo pass', () => {
    const two =
      '<text x="10" y="20" font-size="12">Alpha</text><text x="14" y="22" font-size="12">Beta</text>';
    expect(rules(svg(two))).toEqual(['text-overlap']);
    const halo =
      '<text x="10" y="20" font-size="12" stroke="white">Alpha</text><text x="10" y="20" font-size="12">Alpha</text>';
    expect(rules(svg(halo))).toEqual([]);
  });

  it('does not count stacked lines that merely touch', () => {
    const stacked =
      '<text x="10" y="20" font-size="12">Line one</text><text x="10" y="33" font-size="12">Line two</text>';
    expect(rules(svg(stacked))).toEqual([]);
  });

  it('splits tspans with dy into separate lines', () => {
    const multi =
      '<text x="10" y="20" font-size="12"><tspan x="10" dy="0">First</tspan><tspan x="10" dy="1.2em">Second</tspan></text>';
    expect(rules(svg(multi))).toEqual([]);
  });

  it('ignores hidden text: display none, opacity 0, defs, and a static style rule', () => {
    const hidden =
      '<style>.tip{opacity:0}.tip:hover{opacity:1}</style>' +
      '<text x="10" y="20" font-size="12">Alpha</text>' +
      '<text class="tip" x="10" y="20" font-size="12">Tooltip text</text>' +
      '<text x="10" y="20" font-size="12" display="none">Gone</text>' +
      '<g opacity="0"><text x="10" y="20" font-size="12">Faded</text></g>' +
      '<defs><text x="10" y="20" font-size="12">Def</text></defs>';
    expect(lintSvg(svg(hidden))).toEqual([]);
  });

  it('flags text drawn below the readable size, after scaling', () => {
    expect(rules(svg('<text x="10" y="20" font-size="6">tiny</text>'))).toEqual(
      ['text-tiny']
    );
    expect(
      rules(
        svg(
          '<g transform="scale(0.5)"><text x="20" y="40" font-size="12">tiny</text></g>'
        )
      )
    ).toEqual(['text-tiny']);
  });

  it('flags an empty render', () => {
    expect(rules('')).toEqual(['blank']);
    expect(rules(svg(''))).toEqual(['blank']);
  });

  it('composes rotate about a centre', () => {
    const m = parseTransform('rotate(90 10 10)');
    // (20,10) rotated 90° about (10,10) lands on (10,20).
    expect(m[0] * 20 + m[2] * 10 + m[4]).toBeCloseTo(10);
    expect(m[1] * 20 + m[3] * 10 + m[5]).toBeCloseTo(20);
  });
});
