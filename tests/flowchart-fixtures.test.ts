import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseFlowchart } from '../src/graph/flowchart-parser';

const FIXTURE_DIR = resolve(__dirname, '../gallery/fixtures');

const FIXTURE_FILES = [
  'flowchart-basic.dgmo',
  'flowchart-decision.dgmo',
  'flowchart-nested.dgmo',
  'flowchart-shapes.dgmo',
  'flowchart-groups.dgmo',
  'flowchart-loop.dgmo',
  'flowchart-complex.dgmo',
  'flowchart-colors.dgmo',
];

describe('flowchart fixtures', () => {
  for (const file of FIXTURE_FILES) {
    it(`${file} parses without errors`, () => {
      const content = readFileSync(resolve(FIXTURE_DIR, file), 'utf-8');
      const result = parseFlowchart(content);
      expect(result.error).toBeUndefined();
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.edges.length).toBeGreaterThan(0);
    });
  }

  it('flowchart-basic has linear structure', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'flowchart-basic.dgmo'), 'utf-8');
    const result = parseFlowchart(content);
    expect(result.title).toBe('Basic Flow');
    expect(result.nodes).toHaveLength(5); // Start, Step 1, Step 2, Step 3, End
    expect(result.edges).toHaveLength(4);
  });

  it('flowchart-decision has branching with labeled edges', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'flowchart-decision.dgmo'), 'utf-8');
    const result = parseFlowchart(content);
    const labeledEdges = result.edges.filter((e) => e.label);
    expect(labeledEdges.length).toBeGreaterThanOrEqual(2);
    expect(result.nodes.some((n) => n.shape === 'decision')).toBe(true);
    expect(result.nodes.some((n) => n.shape === 'io')).toBe(true);
  });

  it('flowchart-nested has multi-level decisions with convergence', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'flowchart-nested.dgmo'), 'utf-8');
    const result = parseFlowchart(content);
    const decisions = result.nodes.filter((n) => n.shape === 'decision');
    expect(decisions.length).toBeGreaterThanOrEqual(2);
    // Multiple paths converge to (End)
    const endNode = result.nodes.find((n) => n.label === 'End');
    expect(endNode).toBeDefined();
    const edgesToEnd = result.edges.filter((e) => e.target === endNode!.id);
    expect(edgesToEnd.length).toBeGreaterThanOrEqual(2);
  });

  it('flowchart-shapes has all 6 shape types', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'flowchart-shapes.dgmo'), 'utf-8');
    const result = parseFlowchart(content);
    const shapes = new Set(result.nodes.map((n) => n.shape));
    expect(shapes.has('terminal')).toBe(true);
    expect(shapes.has('process')).toBe(true);
    expect(shapes.has('decision')).toBe(true);
    expect(shapes.has('io')).toBe(true);
    expect(shapes.has('subroutine')).toBe(true);
    expect(shapes.has('document')).toBe(true);
    expect(shapes.size).toBe(6);
  });

  it('flowchart-groups has groups with colors', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'flowchart-groups.dgmo'), 'utf-8');
    const result = parseFlowchart(content);
    expect(result.groups).toBeDefined();
    expect(result.groups!.length).toBeGreaterThanOrEqual(3);
    expect(result.direction).toBe('LR');
    // Groups have colors
    const coloredGroups = result.groups!.filter((g) => g.color);
    expect(coloredGroups.length).toBeGreaterThanOrEqual(3);
  });

  it('flowchart-loop has back-edges', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'flowchart-loop.dgmo'), 'utf-8');
    const result = parseFlowchart(content);
    // [Wait & Backoff] -> [Attempt Request] creates a back-edge
    const attemptNode = result.nodes.find((n) => n.label === 'Attempt Request');
    expect(attemptNode).toBeDefined();
    const edgesToAttempt = result.edges.filter((e) => e.target === attemptNode!.id);
    expect(edgesToAttempt.length).toBeGreaterThanOrEqual(2); // from Initialize and from Wait & Backoff
  });

  it('flowchart-complex has groups, labeled edges, and multiple shapes', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'flowchart-complex.dgmo'), 'utf-8');
    const result = parseFlowchart(content);
    expect(result.groups).toBeDefined();
    expect(result.groups!.length).toBe(3);
    expect(result.direction).toBe('LR');
    expect(result.title).toBe('CI/CD Pipeline');
    // Multiple shape types
    const shapes = new Set(result.nodes.map((n) => n.shape));
    expect(shapes.size).toBeGreaterThanOrEqual(4);
    // Has labeled edges
    const labeledEdges = result.edges.filter((e) => e.label);
    expect(labeledEdges.length).toBeGreaterThanOrEqual(4);
    // Many nodes
    expect(result.nodes.length).toBeGreaterThanOrEqual(10);
  });

  it('flowchart-colors has nodes and edges with custom colors', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'flowchart-colors.dgmo'), 'utf-8');
    const result = parseFlowchart(content);
    const coloredNodes = result.nodes.filter((n) => n.color);
    expect(coloredNodes.length).toBeGreaterThanOrEqual(4);
    const coloredEdges = result.edges.filter((e) => e.color);
    expect(coloredEdges.length).toBeGreaterThanOrEqual(2);
  });
});
