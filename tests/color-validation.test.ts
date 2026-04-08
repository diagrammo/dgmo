import { describe, it, expect } from 'vitest';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { parseKanban } from '../src/kanban/parser';
import { resolveColor } from '../src/colors';

function colorDiags(diagnostics: { message: string; severity: string }[]) {
  return diagnostics.filter((d) => d.message.startsWith('Unknown color'));
}

describe('color name validation — boxes-and-lines (flowchart)', () => {
  it('emits a warning diagnostic for an unknown CSS keyword like "magenta"', () => {
    const result = parseFlowchart(['flowchart', 'A -(magenta)-> B'].join('\n'));
    const diags = colorDiags(result.diagnostics);
    expect(diags.length).toBe(1);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].message).toContain('"magenta"');
    // Line 2 in the source
    expect((diags[0] as { line: number }).line).toBe(2);
  });

  it('emits a warning for a hex code', () => {
    const result = parseFlowchart(['flowchart', 'A -(#ff0000)-> B'].join('\n'));
    const diags = colorDiags(result.diagnostics);
    expect(diags.length).toBe(1);
    expect(diags[0].message).toContain('"#ff0000"');
  });

  it('suggests a similar name for a typo', () => {
    const result = parseFlowchart(['flowchart', 'A -(grenn)-> B'].join('\n'));
    const diags = colorDiags(result.diagnostics);
    expect(diags.length).toBe(1);
    expect(diags[0].message.toLowerCase()).toContain("did you mean 'green'");
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
  it('emits warning for unknown tag color in sequence diagram', () => {
    const src = [
      'sequence Demo',
      'tag env',
      '  prod(magenta)',
      '  dev(green)',
      '',
      'A -> B msg',
    ].join('\n');
    const result = parseSequenceDgmo(src);
    const diags = colorDiags(result.diagnostics);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].message).toContain('"magenta"');
  });

  it('produces no color diagnostics for valid colors', () => {
    const src = [
      'sequence Demo',
      'tag env',
      '  prod(red)',
      '  dev(green)',
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
      '  prod(black)',
      '  dev(white)',
      '',
      'A -> B msg',
    ].join('\n');
    const result = parseSequenceDgmo(src);
    expect(colorDiags(result.diagnostics).length).toBe(0);
  });
});

describe('color name validation — kanban', () => {
  it('emits warning for unknown column color', () => {
    const src = ['kanban', '[Todo](magenta)', '  Card 1'].join('\n');
    const result = parseKanban(src);
    const diags = colorDiags(result.diagnostics);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].message).toContain('"magenta"');
  });

  it('produces no diagnostics for valid column color', () => {
    const src = ['kanban', '[Todo](red)', '  Card 1'].join('\n');
    const result = parseKanban(src);
    expect(colorDiags(result.diagnostics).length).toBe(0);
  });

  it('produces no diagnostics for black and white column colors', () => {
    const src = [
      'kanban',
      '[Todo](black)',
      '  Card 1',
      '[Done](white)',
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
