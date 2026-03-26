import { describe, it, expect } from 'vitest';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { parseClassDiagram } from '../src/class/parser';
import { parseERDiagram } from '../src/er/parser';
import { parseVisualization } from '../src/d3';
import { parseExtendedChart } from '../src/echarts';
import { parseChart } from '../src/chart';

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
      'sequence\nDB is a database\nAPI is a service'
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
    const result = parseFlowchart(
      'flowchart\n[Start] -> [Process]\n[Orphan]'
    );
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('Orphan');
  });

  it('does not warn when all nodes connected', () => {
    const result = parseFlowchart(
      'flowchart\n[Start] -> [Process] -> [End]'
    );
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
    const result = parseClassDiagram(
      'class\nAnimal\nDog extends Animal'
    );
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
      'er\nusers\norders\nusers 1--* orders\norphan'
    );
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('orphan');
  });

  it('does not warn when all tables connected', () => {
    const result = parseERDiagram(
      'er\nusers\norders\nusers 1--* orders'
    );
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
    const result = parseVisualization('chart: timeline');
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('No events found');
  });

  it('arc: accepts direction LR as alias for orientation: horizontal', () => {
    const result = parseVisualization('arc\ndirection LR\nA -> B');
    expect(result.orientation).toBe('horizontal');
  });

  it('arc: accepts direction TB as orientation: vertical', () => {
    const result = parseVisualization('arc\ndirection TB\nA -> B');
    expect(result.orientation).toBe('vertical');
  });

  it('timeline: accepts direction horizontal as orientation', () => {
    const result = parseVisualization('timeline\ndirection horizontal\n2024-01 Launch');
    expect(result.orientation).toBe('horizontal');
  });

  it('quadrant: warns about no data points', () => {
    const result = parseVisualization('quadrant');
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('No data points found');
  });

  it('slope: warns about no data lines', () => {
    const result = parseVisualization('slope\n2020, 2024');
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('No data lines found');
  });

  it('slope: warns about value count mismatch and filters data', () => {
    const result = parseVisualization('slope\n2020, 2024\nApple: 25\nBanana: 10, 20');
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('Apple');
    // Mismatched items filtered out
    expect(result.data).toHaveLength(1);
    expect(result.data[0].label).toBe('Banana');
  });

  it('venn: unknown color name emits warning', () => {
    const result = parseVisualization('venn\nMath(magenta)\nScience(blue)');
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

describe('chart: non-fatal validation warnings', () => {
  it('warns about no data points', () => {
    const result = parseChart('bar');
    expect(result.error).toBeNull();
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('No data points found');
    expect(warnings[0].line).toBe(1);
  });

  it('warns about series count mismatch and filters data', () => {
    const result = parseChart(
      'line\nseries A, B\nX 1\nY 10, 20'
    );
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

  it('chart: unsupported chart type has correct line', () => {
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

tag Team alias t
  Frontend(blue)
  Backend(green)

[Q1]
  2026-01 Auth redesign | t: Backend`);
    expect(result.timelineTagGroups).toHaveLength(1);
    expect(result.timelineTagGroups[0].name).toBe('Team');
    expect(result.timelineTagGroups[0].alias).toBe('t');
    expect(result.timelineTagGroups[0].entries).toHaveLength(2);
  });

  it('parses pipe metadata on point events', () => {
    const result = parseVisualization(`timeline

tag Team alias t
  Frontend(blue)

[Q1]
  2026-01 Dashboard v2 | t: Frontend`);
    expect(result.timelineEvents[0].label).toBe('Dashboard v2');
    expect(result.timelineEvents[0].metadata).toEqual({ team: 'Frontend' });
  });

  it('parses pipe metadata on range events', () => {
    const result = parseVisualization(`timeline

tag Team alias t
  Backend(green)

[Q1]
  2026-01->2026-03 API migration | t: Backend`);
    expect(result.timelineEvents[0].label).toBe('API migration');
    expect(result.timelineEvents[0].metadata).toEqual({ team: 'Backend' });
  });

  it('parses pipe metadata on duration events', () => {
    const result = parseVisualization(`timeline

tag Team
  Platform(teal)

[Q1]
  2026-01->3m Gateway setup | Team: Platform`);
    expect(result.timelineEvents[0].label).toBe('Gateway setup');
    expect(result.timelineEvents[0].metadata).toEqual({ team: 'Platform' });
  });

  it('injects default tag values', () => {
    const result = parseVisualization(`timeline

tag Team
  Frontend(blue)
  Platform(teal) default

[Q1]
  2026-01 Some task`);
    expect(result.timelineEvents[0].metadata.team).toBe('Platform');
  });

  it('warns on unknown tag values', () => {
    const result = parseVisualization(`timeline

tag Team
  Frontend(blue)

[Q1]
  2026-01 Task | Team: Unknown`);
    const warnings = result.diagnostics.filter(d => d.message.includes("Unknown value 'Unknown'"));
    expect(warnings).toHaveLength(1);
  });

  it('existing timelines without tags still work', () => {
    const result = parseVisualization(`timeline

[Q1]
  2026-01 Some task
  2026-02->2026-03 Another task`);
    expect(result.error).toBeNull();
    expect(result.timelineTagGroups).toHaveLength(0);
    expect(result.timelineEvents).toHaveLength(2);
    expect(result.timelineEvents[0].metadata).toEqual({});
  });
});

describe('timeline sort: tag directive', () => {
  it('parses sort: tag and defaults swimlane to first tag group', () => {
    const result = parseVisualization(`timeline
sort tag

tag Pirate alias p
  Blackbeard(red)
  Roberts(blue)

1716 Event | p: Blackbeard`);
    expect(result.timelineSort).toBe('tag');
    expect(result.timelineDefaultSwimlaneTG).toBe('Pirate');
  });

  it('parses sort tag:GroupName with explicit group', () => {
    const result = parseVisualization(`timeline
sort tag:Outcome

tag Pirate alias p
  Blackbeard(red)

tag Outcome alias o
  Victory(green)
  Defeat(red)

1716 Event | p: Blackbeard, o: Victory`);
    expect(result.timelineSort).toBe('tag');
    expect(result.timelineDefaultSwimlaneTG).toBe('Outcome');
  });

  it('resolves alias in sort tag:alias', () => {
    const result = parseVisualization(`timeline
sort tag:p

tag Pirate alias p
  Blackbeard(red)
  Roberts(blue)

1716 Event | p: Blackbeard`);
    expect(result.timelineSort).toBe('tag');
    expect(result.timelineDefaultSwimlaneTG).toBe('Pirate');
  });

  it('warns and falls back to first group when alias not found', () => {
    const result = parseVisualization(`timeline
sort tag:nonexistent

tag Pirate alias p
  Blackbeard(red)

tag Outcome alias o
  Victory(green)

1716 Event | p: Blackbeard`);
    expect(result.timelineSort).toBe('tag');
    expect(result.timelineDefaultSwimlaneTG).toBe('Pirate');
    const warnings = result.diagnostics.filter((d) =>
      d.message.includes('no tag group matches')
    );
    expect(warnings).toHaveLength(1);
  });

  it('falls back to sort: time when no tag groups defined', () => {
    const result = parseVisualization(`timeline
sort tag

[Q1]
  2026-01 Some task`);
    expect(result.timelineSort).toBe('time');
    const warnings = result.diagnostics.filter((d) =>
      d.message.includes('requires at least one tag group')
    );
    expect(warnings).toHaveLength(1);
  });

  it('case-insensitive alias resolution', () => {
    const result = parseVisualization(`timeline
sort tag:P

tag Pirate alias p
  Blackbeard(red)

1716 Event | p: Blackbeard`);
    expect(result.timelineSort).toBe('tag');
    expect(result.timelineDefaultSwimlaneTG).toBe('Pirate');
  });

  it('preserves sort: time (default)', () => {
    const result = parseVisualization(`timeline

tag Pirate alias p
  Blackbeard(red)

1716 Event | p: Blackbeard`);
    expect(result.timelineSort).toBe('time');
    expect(result.timelineDefaultSwimlaneTG).toBeUndefined();
  });

  it('preserves sort group', () => {
    const result = parseVisualization(`timeline
sort group

[Engineering]
  2026-01 Task A`);
    expect(result.timelineSort).toBe('group');
  });
});
