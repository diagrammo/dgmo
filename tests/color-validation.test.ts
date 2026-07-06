import { describe, it, expect } from 'vitest';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { parseKanban } from '../src/kanban/parser';
import {
  resolveColor,
  resolveColorWithDiagnostic,
  nearestNamedColor,
  INVALID_COLOR_CODE,
  RECOGNIZED_COLOR_NAMES,
  colorNames,
} from '../src/colors';
import { parseExtendedChart } from '../src/data-chart-parser';
import { parseDgmo } from '../src/dgmo-router';
import type { DgmoError } from '../src/diagnostics';

function colorDiags(diagnostics: { message: string; severity: string }[]) {
  return diagnostics.filter((d) => d.message.startsWith('Unknown color'));
}

// ============================================================
// Frozen palette contract (decision #17): the 11 color names are a public
// grammar surface. Adding a 12th (or renaming one) would silently change the
// meaning of any user diagram that uses the new word as a label, so it MUST be
// a deliberate major-version bump. This assertion makes such a change fail CI
// loudly rather than slip in. If you are intentionally changing the palette
// names, update this literal in the same commit that bumps the major version.
// ============================================================
describe('frozen palette contract (11 color names)', () => {
  const FROZEN_COLOR_NAMES = [
    'red',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'teal',
    'cyan',
    'gray',
    'black',
    'white',
  ];

  it('RECOGNIZED_COLOR_NAMES equals the frozen literal list', () => {
    expect([...RECOGNIZED_COLOR_NAMES]).toEqual(FROZEN_COLOR_NAMES);
  });

  it('the colorNames resolver map covers exactly the frozen names', () => {
    expect(Object.keys(colorNames).sort()).toEqual(
      [...FROZEN_COLOR_NAMES].sort()
    );
  });
});

describe('color name validation — flowchart (TD-11 fall-through)', () => {
  // Per TD-11 "greedy-for-color, fall-through-to-label": if `(X)` is not one
  // of the 11 recognized palette colors, the entire `(X)` becomes the label.
  // No "Unknown color" warning is emitted because the parser no longer
  // interprets the token as a color at all.
  it('TD-11: unknown CSS keyword like "magenta" becomes a label, no diagnostic', () => {
    const result = parseFlowchart(
      ['flowchart', '[A] -(magenta)-> [B]'].join('\n')
    );
    expect(colorDiags(result.diagnostics).length).toBe(0);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].color).toBeUndefined();
    expect(result.edges[0].label).toBe('(magenta)');
  });

  it('TD-11: hex code in parens becomes a label', () => {
    const result = parseFlowchart(
      ['flowchart', '[A] -(#ff0000)-> [B]'].join('\n')
    );
    expect(colorDiags(result.diagnostics).length).toBe(0);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].label).toBe('(#ff0000)');
    expect(result.edges[0].color).toBeUndefined();
  });

  it('TD-11: typo like "grenn" becomes a label (no suggestion in parser)', () => {
    const result = parseFlowchart(
      ['flowchart', '[A] -(grenn)-> [B]'].join('\n')
    );
    expect(colorDiags(result.diagnostics).length).toBe(0);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].label).toBe('(grenn)');
  });

  it('produces no diagnostic for a valid color name', () => {
    const result = parseFlowchart(['flowchart', 'A -(red)-> B'].join('\n'));
    expect(colorDiags(result.diagnostics).length).toBe(0);
  });

  it('produces no diagnostic for black or white', () => {
    const result = parseFlowchart(
      ['flowchart', 'A -(black)-> B', 'C -(white)-> D'].join('\n')
    );
    expect(colorDiags(result.diagnostics).length).toBe(0);
  });
});

describe('color name validation — sequence', () => {
  it('silently accepts unrecognized trailing-token color (spec §1.5)', () => {
    // Under the universal trailing-token rule, an unrecognized color word
    // is just label text — no diagnostic. Accepted tradeoff (silent typo).
    const src = [
      'sequence Demo',
      'tag env',
      '  prod magenta',
      '  dev green',
      '',
      'A -> B msg',
    ].join('\n');
    const result = parseSequenceDgmo(src);
    expect(colorDiags(result.diagnostics).length).toBe(0);
  });

  it('produces no color diagnostics for valid colors', () => {
    const src = [
      'sequence Demo',
      'tag env',
      '  prod red',
      '  dev green',
      '',
      'A -> B msg',
    ].join('\n');
    const result = parseSequenceDgmo(src);
    expect(colorDiags(result.diagnostics).length).toBe(0);
  });

  it('produces no diagnostics for black and white tag colors', () => {
    const src = [
      'sequence Demo',
      'tag env',
      '  prod black',
      '  dev white',
      '',
      'A -> B msg',
    ].join('\n');
    const result = parseSequenceDgmo(src);
    expect(colorDiags(result.diagnostics).length).toBe(0);
  });
});

describe('color name validation — kanban', () => {
  it('silently treats unknown trailing token as garbage (matches §1.5 universal rule)', () => {
    // After the 0.18.0 unified-metadata refactor, kanban no longer
    // emits "Unknown color" for non-palette trailing tokens — it
    // aligns with the §1.5 silent-typo policy applied across all
    // chart types.
    const src = ['kanban', '[Todo] magenta', '  Card 1'].join('\n');
    const result = parseKanban(src);
    const diags = colorDiags(result.diagnostics);
    expect(diags.length).toBe(0);
    expect(result.columns[0]?.color).toBeUndefined();
  });

  it('produces no diagnostics for valid column color', () => {
    const src = ['kanban', '[Todo] red', '  Card 1'].join('\n');
    const result = parseKanban(src);
    expect(colorDiags(result.diagnostics).length).toBe(0);
  });

  it('produces no diagnostics for black and white column colors', () => {
    const src = [
      'kanban',
      '[Todo] black',
      '  Card 1',
      '[Done] white',
      '  Card 2',
    ].join('\n');
    const result = parseKanban(src);
    expect(colorDiags(result.diagnostics).length).toBe(0);
  });
});

describe('black/white resolve to hex', () => {
  it('resolves to a hex string using the default palette', () => {
    const black = resolveColor('black');
    const white = resolveColor('white');
    expect(black).toMatch(/^#[0-9a-f]{6}$/i);
    expect(white).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('hex / CSS colors are rejected with an error diagnostic', () => {
  it('resolveColor returns null for hex, rgb(), hsl()', () => {
    expect(resolveColor('#e6194b')).toBeNull();
    expect(resolveColor('rgb(255,0,0)')).toBeNull();
    expect(resolveColor('hsl(0,100%,50%)')).toBeNull();
  });

  it('resolveColorWithDiagnostic emits a hex-specific ERROR (not a typo warning)', () => {
    const diagnostics: DgmoError[] = [];
    const result = resolveColorWithDiagnostic('#e6194b', 1, diagnostics);
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].message).toMatch(/hex or CSS color values/);
    expect(diagnostics[0].message).toMatch(/named palette color/);
  });

  it('rgb()/hsl() literals also error', () => {
    for (const literal of [
      'rgb(255,0,0)',
      'rgba(0,0,0,0.5)',
      'hsl(0,100%,50%)',
    ]) {
      const diagnostics: DgmoError[] = [];
      resolveColorWithDiagnostic(literal, 1, diagnostics);
      expect(diagnostics[0]?.severity).toBe('error');
    }
  });

  it('stamps the stable E_INVALID_COLOR code on hex AND unknown-name diagnostics', () => {
    const hexD: DgmoError[] = [];
    resolveColorWithDiagnostic('#e6194b', 1, hexD);
    expect(hexD[0].code).toBe(INVALID_COLOR_CODE);
    expect(hexD[0].severity).toBe('error');

    const cssD: DgmoError[] = [];
    resolveColorWithDiagnostic('crimson', 1, cssD);
    expect(cssD[0].code).toBe(INVALID_COLOR_CODE);
    // CSS color names stay a warning in the library (app/CLI degrade
    // gracefully); the MCP gate blocks on the code regardless of severity.
    expect(cssD[0].severity).toBe('warning');
    expect(cssD[0].message).toMatch(/only these 11 named colors/);
  });

  it('hex diagnostic includes a nearest-named suggestion', () => {
    const d: DgmoError[] = [];
    resolveColorWithDiagnostic('#e6194b', 1, d);
    expect(d[0].message).toMatch(/Nearest: red\./);
  });

  it('nearestNamedColor maps hex by RGB distance, null for non-hex', () => {
    expect(nearestNamedColor('#e6194b')).toBe('red');
    expect(nearestNamedColor('#4363d8')).toBe('blue');
    expect(nearestNamedColor('#3cb44b')).toBe('green');
    // CSS color names resolve via the blocklist map to their nearest valid name
    expect(nearestNamedColor('crimson')).toBe('red');
    expect(nearestNamedColor('navy')).toBe('blue');
    // rgb()/hsl() functions and genuine non-colors have no hex to read → null
    expect(nearestNamedColor('rgb(255,0,0)')).toBeNull();
    expect(nearestNamedColor('Zinfandel')).toBeNull();
  });

  it('scatter [group] hex header errors and applies no color', () => {
    const content = `scatter
x-label GDP
y-label Power

[North America] #e6194b
  United States 76300 12700`;
    const parsed = parseExtendedChart(content);
    const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((d) => /hex or CSS color values/.test(d.message))).toBe(
      true
    );
    // hex is never applied as the category color
    expect(parsed.categoryColors?.['North America']).toBeUndefined();
  });
});

describe('trailing-token slots flag intended-but-invalid colors (no silent swallow)', () => {
  // Regression: a CSS color name in a tag declaration used to be silently
  // folded into the label with zero diagnostics, so the MCP color gate had
  // nothing to block. It must now emit E_INVALID_COLOR.
  it('CSS color name (pink) in a mindmap tag declaration emits E_INVALID_COLOR', () => {
    const src = `mindmap Wine

tag Style as s
  Red red
  Rosé pink

Reds s: Red
  Cabernet
Rosé s: Rosé
  Provence`;
    const { diagnostics } = parseDgmo(src);
    const inv = diagnostics.filter((d) => d.code === INVALID_COLOR_CODE);
    expect(inv).toHaveLength(1);
    expect(inv[0].message).toMatch(/pink/);
    expect(inv[0].message).toMatch(/Nearest: red/);
  });

  it('a genuine label word (Zinfandel) in a tag value is NOT flagged', () => {
    const src = `mindmap Wine

tag Style as s
  White Zinfandel
  Red red

Whites s: White
  Chardonnay`;
    const { diagnostics } = parseDgmo(src);
    expect(
      diagnostics.filter((d) => d.code === INVALID_COLOR_CODE)
    ).toHaveLength(0);
  });

  it('hex in a tag-entry trailing slot is flagged', () => {
    const src = `mindmap Wine

tag Style as s
  Red #ff0000
  White white

Reds s: Red
  Cabernet`;
    const { diagnostics } = parseDgmo(src);
    const inv = diagnostics.filter((d) => d.code === INVALID_COLOR_CODE);
    expect(inv).toHaveLength(1);
    expect(inv[0].message).toMatch(/#ff0000/);
  });
});
