// The "is this diagram valid?" answer both MCP servers give
// (src/validate-diagram.ts). The flowchart cases moved here from dgmo-mcp
// with the code.

import { describe, it, expect } from 'vitest';
import {
  validateFlowchartStructure,
  validateDiagram,
  formatDiagramValidation,
} from '../src/validate-diagram';

describe('validateFlowchartStructure', () => {
  it('flags a node that is declared but never wired into the flow', () => {
    const src = `flowchart T
(Start) -> <Worked?>
<Worked?> -yes-> (Approved)
<Worked?> -no-> (Denied)
[Floating]`;
    const issues = validateFlowchartStructure(src);
    const msgs = issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/Floating.*not connected/);
    // Well-formed nodes are NOT flagged.
    expect(msgs).not.toMatch(/Worked\?.*not connected/);
    expect(msgs).not.toMatch(/Start.*not connected/);
  });

  it('flags a decision with only one branch', () => {
    const src = `flowchart T
(Start) -> <Ready?>
<Ready?> -yes-> (Done)`;
    const issues = validateFlowchartStructure(src);
    expect(issues.map((i) => i.message).join('\n')).toMatch(
      /Decision "Ready\?".*at least two/
    );
  });

  it('accepts a decision with non-binary specific labels', () => {
    const src = `flowchart T
(Start) -> <Type?>
<Type?> -retirement-> (A)
<Type?> -disability-> (B)
<Type?> -survivor-> (C)`;
    const issues = validateFlowchartStructure(src);
    expect(issues).toHaveLength(0);
  });

  it('passes a fully-connected, well-formed flow', () => {
    const src = `flowchart T
(Start) -> [Collect info] -> <Worked?>
<Worked?> -yes-> (Approved)
<Worked?> -no-> (Denied)`;
    const issues = validateFlowchartStructure(src);
    expect(issues).toHaveLength(0);
  });

  it('flags a flow with no end (pure cycle)', () => {
    const src = `flowchart T
[A] -> [B]
[B] -> [A]`;
    const issues = validateFlowchartStructure(src);
    expect(issues.map((i) => i.message).join('\n')).toMatch(/no end/);
  });
});

describe('validateDiagram', () => {
  it('a clean sequence is valid', () => {
    const v = validateDiagram('sequence Checkout\n\nClient -pay-> Server');
    expect(v.chartType).toBe('sequence');
    expect(v.errors).toEqual([]);
    expect(formatDiagramValidation(v)).toEqual({
      text: 'Valid sequence diagram — no errors or warnings.',
      isError: false,
    });
  });

  it('a disconnected flowchart node blocks', () => {
    const v = validateDiagram(`flowchart T
(Start) -> (End)
[Floating]`);
    expect(v.errors.some((e) => e.code === 'E_FLOWCHART_STRUCTURE')).toBe(true);
    const f = formatDiagramValidation(v);
    expect(f.isError).toBe(true);
    expect(f.text).toMatch(/^1 error, 1 warning in flowchart diagram\n/);
    expect(f.text).toContain('Errors:');
  });

  it('an invalid colour blocks whatever severity the parser gave it', () => {
    const v = validateDiagram(`mindmap Wine

tag Style as s
  Red red
  Rosé pink

Reds s: Red
  Cabernet
Rosé s: Rosé
  Provence`);
    expect(v.errors.some((e) => e.code === 'E_INVALID_COLOR')).toBe(true);
    expect(v.warnings.some((e) => e.code === 'E_INVALID_COLOR')).toBe(false);
    expect(formatDiagramValidation(v).isError).toBe(true);
  });

  it('a map without map data is checked by the parser alone', () => {
    const v = validateDiagram('map World\n\nregion Atlantis');
    expect(v.chartType).toBe('map');
    expect(Array.isArray(v.errors)).toBe(true);
  });
});
