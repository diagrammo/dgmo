import { describe, it, expect } from 'vitest';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { parseClassDiagram } from '../src/class/parser';
import { parseERDiagram } from '../src/er/parser';
import { parseVisualization } from '../src/d3';
import { parseExtendedChart } from '../src/data-chart-parser';
import { parseChart } from '../src/chart';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { parseCycle } from '../src/cycle/parser';

// ============================================================
// Sequence: unused participants
// ============================================================

describe('sequence: unused participant warnings', () => {
  it('warns about declared-but-unused participant', () => {
    const result = parseSequenceDgmo(
      'sequence\nDB is a database\nUser -request-> API'
    );
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('DB');
    expect(warnings[0].message).toContain('never used');
  });

  it('does not warn when all participants are used', () => {
    const result = parseSequenceDgmo(
      'sequence\nUser -request-> API\nAPI -query-> DB'
    );
    expect(result.error).toBeNull();
    expect(
      result.diagnostics.filter((d) => d.severity === 'warning')
    ).toHaveLength(0);
  });

  it('does not warn in incomplete diagrams (no messages)', () => {
    const result = parseSequenceDgmo(
      'sequence\nDB is a database\nAPI is an actor'
    );
    expect(result.error).toBeNull();
    expect(
      result.diagnostics.filter((d) => d.severity === 'warning')
    ).toHaveLength(0);
  });

  it('counts note references as usage', () => {
    const result = parseSequenceDgmo(
      'sequence\nDB is a database\nUser -request-> API\nnote right of DB stores data'
    );
    expect(result.error).toBeNull();
    expect(
      result.diagnostics.filter((d) => d.severity === 'warning')
    ).toHaveLength(0);
  });
});

// ============================================================
// Sequence: empty groups
// ============================================================

describe('sequence: empty group warnings', () => {
  it('warns about group with no participants', () => {
    const result = parseSequenceDgmo(
      'sequence\n[Backend]\n\nUser -request-> API'
    );
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings.some((w) => w.message.includes('Backend'))).toBe(true);
    expect(warnings.some((w) => w.message.includes('== Backend =='))).toBe(
      true
    );
  });
});

// ============================================================
// Flowchart: orphaned nodes
// ============================================================

describe('flowchart: orphaned node warnings', () => {
  it('warns about node not connected to any edge', () => {
    const result = parseFlowchart('flowchart\n[Start] -> [Process]\n[Orphan]');
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('Orphan');
  });

  it('does not warn when all nodes connected', () => {
    const result = parseFlowchart('flowchart\n[Start] -> [Process] -> [End]');
    expect(result.error).toBeNull();
    expect(
      result.diagnostics.filter((d) => d.severity === 'warning')
    ).toHaveLength(0);
  });

  it('does not warn for single-node diagrams', () => {
    const result = parseFlowchart('flowchart\n[Single]');
    expect(result.error).toBeNull();
    expect(
      result.diagnostics.filter((d) => d.severity === 'warning')
    ).toHaveLength(0);
  });
});

// ============================================================
// Class: isolated classes
// ============================================================

describe('class: isolated class warnings', () => {
  it('warns about class not in any relationship', () => {
    const result = parseClassDiagram(
      'class\nAnimal\nDog extends Animal\nOrphan'
    );
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('Orphan');
  });

  it('does not warn when all classes connected', () => {
    const result = parseClassDiagram('class\nAnimal\nDog extends Animal');
    expect(result.error).toBeNull();
    expect(
      result.diagnostics.filter((d) => d.severity === 'warning')
    ).toHaveLength(0);
  });
});

// ============================================================
// ER: isolated tables
// ============================================================

describe('er: isolated table warnings', () => {
  it('warns about table not in any relationship', () => {
    const result = parseERDiagram(
      'er\nusers\n  id int pk\n  1-* orders\norders\n  id int pk\norphan'
    );
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('orphan');
  });

  it('does not warn when all tables connected', () => {
    const result = parseERDiagram('er\nusers\n  1-* orders\norders');
    expect(result.error).toBeNull();
    expect(
      result.diagnostics.filter((d) => d.severity === 'warning')
    ).toHaveLength(0);
  });
});

// ============================================================
// D3: validation warnings (non-fatal)
// ============================================================

describe('d3: non-fatal validation warnings', () => {
  it('wordcloud: warns about no words', () => {
    const result = parseVisualization('wordcloud');
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('No words found');
    expect(warnings[0].line).toBe(1);
  });

  it('arc: warns about no links', () => {
    const result = parseVisualization('arc');
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('No links found');
  });

  it('timeline: warns about no events', () => {
    const result = parseVisualization('timeline');
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('No events found');
  });

  it('quadrant: warns about no data points', () => {
    const result = parseVisualization('quadrant');
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('No data points found');
  });

  it('slope: warns about no data lines', () => {
    const result = parseVisualization('slope\nperiod 2020 2024');
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('No data lines found');
  });

  it('slope: warns about value count mismatch and filters data', () => {
    const result = parseVisualization(
      'slope\nperiod 2020 2024\nApple 25\nBanana 10 20'
    );
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('numeric value');
    // Mismatched items skipped during right-scan
    expect(result.data).toHaveLength(1);
    expect(result.data[0].label).toBe('Banana');
  });

  it.skip('venn: unknown color name emits warning (obsolete: silent-typo design per §1.5)', () => {
    const result = parseVisualization('venn\nMath(magenta)\nScience blue');
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('magenta');
  });

  it('venn: keeps fatal error for too few sets', () => {
    const result = parseVisualization('venn\nOnlyOne');
    expect(result.error).not.toBeNull();
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('slope: keeps fatal error for missing periods', () => {
    const result = parseVisualization('slope');
    expect(result.error).not.toBeNull();
    expect(result.diagnostics[0].severity).toBe('error');
  });
});

// ============================================================
// ECharts: validation warnings (non-fatal)
// ============================================================

describe('echarts: non-fatal validation warnings', () => {
  it('sankey: warns about no links', () => {
    const result = parseExtendedChart('sankey');
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('No links found');
    expect(warnings[0].line).toBe(1);
  });

  it('scatter: warns about no points', () => {
    const result = parseExtendedChart('scatter');
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('No scatter points found');
  });

  it('funnel: warns about no data', () => {
    const result = parseExtendedChart('funnel');
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('No data found');
  });

  it('keeps fatal error for unsupported type', () => {
    const result = parseExtendedChart('bogus');
    expect(result.error).toBeDefined();
    expect(result.diagnostics[0].severity).toBe('error');
    expect(result.diagnostics[0].line).toBe(1);
  });
});

// ============================================================
// Chart: validation warnings (non-fatal)
// ============================================================

describe('non-fatal validation warnings', () => {
  it('warns about no data points', () => {
    const result = parseChart('bar');
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('No data points found');
    expect(warnings[0].line).toBe(1);
  });

  it('warns about series count mismatch and filters data', () => {
    const result = parseChart('line\nseries A, B\nX 1\nY 10 20');
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('X');
    // Mismatched data points are filtered out
    expect(result.data).toHaveLength(1);
    expect(result.data[0].label).toBe('Y');
  });

  it('keeps fatal error for bar-stacked without series', () => {
    const result = parseChart('bar-stacked\nA: 10');
    expect(result.error).toBeDefined();
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('keeps fatal error for unsupported chart type', () => {
    const result = parseChart('bogus');
    expect(result.error).toBeDefined();
    expect(result.diagnostics[0].severity).toBe('error');
    expect(result.diagnostics[0].line).toBe(1);
  });
});

// ============================================================
// Line number fixes (Part A)
// ============================================================

describe('line number fixes', () => {
  it('sequence: unsupported chart type has correct line', () => {
    const result = parseSequenceDgmo('bogus');
    expect(result.error).not.toBeNull();
    expect(result.diagnostics[0].line).toBe(1);
  });

  it('d3: unsupported chart type has correct line', () => {
    const result = parseVisualization('bogus');
    expect(result.error).not.toBeNull();
    expect(result.diagnostics[0].line).toBe(1);
  });

  it('echarts: unsupported chart type has correct line', () => {
    const result = parseExtendedChart('bogus');
    expect(result.error).toBeDefined();
    expect(result.diagnostics[0].line).toBe(1);
  });

  it('unsupported chart type has correct line', () => {
    const result = parseChart('bogus');
    expect(result.error).toBeDefined();
    expect(result.diagnostics[0].line).toBe(1);
  });
});

// ============================================================
// Timeline Tag Groups
// ============================================================

describe('timeline tag groups', () => {
  it('parses tag: blocks with entries', () => {
    const result = parseVisualization(`timeline

tag Team as t
  Frontend blue
  Backend green

[Q1]
  2026-01 Auth redesign t: Backend`);
    expect(result.timelineTagGroups).toHaveLength(1);
    expect(result.timelineTagGroups[0].name).toBe('Team');
    expect(result.timelineTagGroups[0].alias).toBe('t');
    expect(result.timelineTagGroups[0].entries).toHaveLength(2);
  });

  it('parses metadata on point events', () => {
    const result = parseVisualization(`timeline

tag Team as t
  Frontend blue

[Q1]
  2026-01 Dashboard v2 t: Frontend`);
    expect(result.timelineEvents[0].label).toBe('Dashboard v2');
    expect(result.timelineEvents[0].metadata).toEqual({ team: 'Frontend' });
  });

  it('parses metadata on range events', () => {
    const result = parseVisualization(`timeline

tag Team as t
  Backend green

[Q1]
  2026-01 -> 2026-03 API migration t: Backend`);
    expect(result.timelineEvents[0].label).toBe('API migration');
    expect(result.timelineEvents[0].metadata).toEqual({ team: 'Backend' });
  });

  it('parses metadata on duration events', () => {
    const result = parseVisualization(`timeline

tag Team
  Platform teal

[Q1]
  2026-01 Gateway setup duration: 3m, Team: Platform`);
    expect(result.timelineEvents[0].label).toBe('Gateway setup');
    expect(result.timelineEvents[0].metadata).toEqual({ team: 'Platform' });
  });

  it('injects default tag values', () => {
    const result = parseVisualization(`timeline

tag Team
  Frontend blue
  Platform teal default

[Q1]
  2026-01 Some task`);
    expect(result.timelineEvents[0].metadata.team).toBe('Platform');
  });

  it('warns on unknown tag values', () => {
    const result = parseVisualization(`timeline

tag Team
  Frontend blue

[Q1]
  2026-01 Task Team: Unknown`);
    const warnings = result.diagnostics.filter((d) =>
      d.message.includes("Unknown value 'Unknown'")
    );
    expect(warnings).toHaveLength(1);
  });

  it('existing timelines without tags still work', () => {
    const result = parseVisualization(`timeline

[Q1]
  2026-01 Some task
  2026-02 -> 2026-03 Another task`);
    expect(result.error).toBeNull();
    expect(result.timelineTagGroups).toHaveLength(0);
    expect(result.timelineEvents).toHaveLength(2);
    expect(result.timelineEvents[0].metadata).toEqual({});
  });
});

describe('timeline era block form', () => {
  it('parses bare era keyword with indented entries', () => {
    const result = parseVisualization(`timeline
era
  2024-01 -> 2024-06 Phase 1
  2024-06 -> 2024-12 Phase 2
2025-01 Event`);
    expect(result.timelineEras).toHaveLength(2);
    expect(result.timelineEras[0].startDate).toBe('2024-01');
    expect(result.timelineEras[0].endDate).toBe('2024-06');
    expect(result.timelineEras[0].label).toBe('Phase 1');
    expect(result.timelineEras[1].startDate).toBe('2024-06');
    expect(result.timelineEras[1].label).toBe('Phase 2');
  });

  it('parses era block entry with color', () => {
    const result = parseVisualization(`timeline
era
  2024-01 -> 2024-06 Sprint blue
2025-01 Event`);
    expect(result.timelineEras).toHaveLength(1);
    expect(result.timelineEras[0].label).toBe('Sprint');
    expect(result.timelineEras[0].color).not.toBeNull();
  });

  it('inline era still works alongside block form', () => {
    const result = parseVisualization(`timeline
era 2024-01 -> 2024-06 Phase 1
era
  2024-06 -> 2024-12 Phase 2
2025-01 Event`);
    expect(result.timelineEras).toHaveLength(2);
  });
});

describe('timeline marker block form', () => {
  it('parses bare marker keyword with indented entries', () => {
    const result = parseVisualization(`timeline
marker
  2024-03-01 Kickoff
  2024-06-15 Release
2025-01 Event`);
    expect(result.timelineMarkers).toHaveLength(2);
    expect(result.timelineMarkers[0].date).toBe('2024-03-01');
    expect(result.timelineMarkers[0].label).toBe('Kickoff');
    expect(result.timelineMarkers[1].date).toBe('2024-06-15');
    expect(result.timelineMarkers[1].label).toBe('Release');
  });

  it('parses marker block entry with color', () => {
    const result = parseVisualization(`timeline
marker
  2024-03-01 Launch green
2025-01 Event`);
    expect(result.timelineMarkers).toHaveLength(1);
    expect(result.timelineMarkers[0].label).toBe('Launch');
    expect(result.timelineMarkers[0].color).not.toBeNull();
  });

  it('inline marker still works alongside block form', () => {
    const result = parseVisualization(`timeline
marker 2024-03-01 Kickoff
marker
  2024-06-15 Release
2025-01 Event`);
    expect(result.timelineMarkers).toHaveLength(2);
  });
});

// ============================================================
// Trailing-colon on edge endpoints
// ============================================================

describe('trailing-colon parse error on edge endpoints', () => {
  it('arc: trailing colon on target', () => {
    const result = parseVisualization(`arc
  Blackbeard -> Bonnet: 8`);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Trailing colon');
    expect(errors[0].message).toContain('Blackbeard -> Bonnet');
    expect(result.links).toHaveLength(0);
  });

  it('arc: trailing colon on source', () => {
    const result = parseVisualization(`arc
  Blackbeard: -> Bonnet 8`);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Trailing colon');
    expect(result.links).toHaveLength(0);
  });

  it('arc: no error without colon', () => {
    const result = parseVisualization(`arc
  Blackbeard -> Bonnet 8`);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
    expect(result.links).toHaveLength(1);
  });

  it('boxes-and-lines: trailing colon on target', () => {
    const result = parseBoxesAndLines(`boxes-and-lines
Source -> Target:`);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Trailing colon');
    expect(result.edges).toHaveLength(0);
  });

  it('boxes-and-lines: trailing colon on source', () => {
    const result = parseBoxesAndLines(`boxes-and-lines
Source: -> Target`);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Trailing colon');
    expect(result.edges).toHaveLength(0);
  });

  it('cycle: trailing colon on edge target', () => {
    const result = parseCycle(`cycle
Node A
  -> Node B:
Node B
  -> Node A`);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Trailing colon');
  });
});
