import { describe, it, expect } from 'vitest';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { parseKanban } from '../src/kanban/parser';
import { resolveColor } from '../src/colors';

function colorDiags(diagnostics: { message: string; severity: string }[]) {
  return diagnostics.filter((d) => d.message.startsWith('Unknown color'));
}

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
