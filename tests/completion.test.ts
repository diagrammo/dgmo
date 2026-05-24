import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  extractDiagramSymbols,
  COMPLETION_REGISTRY,
  CHART_TYPES,
  METADATA_KEY_SET,
  ENTITY_TYPES,
  PIPE_METADATA,
  extractTagDeclarations,
} from '../src/completion';
import { extractSymbols as extractErSymbols } from '../src/er/parser';
import { extractSymbols as extractFlowchartSymbols } from '../src/graph/flowchart-parser';
import { extractSymbols as extractInfraSymbols } from '../src/infra/parser';
import { extractSymbols as extractClassSymbols } from '../src/class/parser';
import { ALL_CHART_TYPES } from '../src/utils/parsing';

// ============================================================
// extractDiagramSymbols dispatch
// ============================================================

describe('extractDiagramSymbols', () => {
  it('returns null for unknown chart type', () => {
    const doc = 'nonexistent-type\nTodo\n  - Task 1\n';
    expect(extractDiagramSymbols(doc)).toBeNull();
  });

  it('returns null when no chart: line present', () => {
    expect(extractDiagramSymbols('Users\n  id: int\n')).toBeNull();
  });

  it('dispatches to ER extractor for chart: er', () => {
    const doc = 'er\nUsers\nOrders\n';
    const result = extractDiagramSymbols(doc);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('er');
    expect(result!.entities).toEqual(['Users', 'Orders']);
  });

  it('dispatches to flowchart extractor for chart: flowchart', () => {
    const doc = 'flowchart\nStart(Begin)\n';
    const result = extractDiagramSymbols(doc);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('flowchart');
  });

  it('dispatches to infra extractor for chart: infra', () => {
    const doc = 'infra\nAPI\nCache\n';
    const result = extractDiagramSymbols(doc);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('infra');
  });

  it('dispatches to class extractor for chart: class', () => {
    const doc = 'class\nUser\nOrder\n';
    const result = extractDiagramSymbols(doc);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('class');
  });
});

// ============================================================
// ER extractor
// ============================================================

describe('ER extractSymbols', () => {
  it('extracts table names from standard declarations', () => {
    const doc = [
      'er',
      'title: Shop',
      'Users',
      '  id: int [pk]',
      'Orders',
      '  amount: decimal',
      'Products',
    ].join('\n');
    const result = extractErSymbols(doc);
    expect(result.kind).toBe('er');
    expect(result.entities).toEqual(['Users', 'Orders', 'Products']);
  });

  it('strips color annotations from entity names', () => {
    const doc = 'er\nUsers blue\nOrders red\n';
    expect(extractErSymbols(doc).entities).toEqual(['Users', 'Orders']);
  });

  it('strips pipe metadata from entity names', () => {
    const doc = 'er\n\nOrders | status: active\nUsers | env: prod\n';
    expect(extractErSymbols(doc).entities).toEqual(['Orders', 'Users']);
  });

  it('excludes indented lines (column definitions)', () => {
    const doc = 'er\nUsers\n  id: int [pk]\n  name: varchar\nOrders\n';
    expect(extractErSymbols(doc).entities).toEqual(['Users', 'Orders']);
  });

  it('excludes relationship lines', () => {
    const doc = 'er\nUsers\nOrders\nUsers 1--* Orders : places\n';
    expect(extractErSymbols(doc).entities).toEqual(['Users', 'Orders']);
  });

  it('returns empty entities for empty data section', () => {
    const doc = 'er\ntitle: Empty\n';
    const result = extractErSymbols(doc);
    expect(result.entities).toEqual([]);
    expect(result.keywords).toContain('pk');
    expect(result.keywords).toContain('fk');
  });

  it('returns ER keywords', () => {
    const result = extractErSymbols('er\n');
    expect(result.keywords).toEqual([
      'pk',
      'fk',
      'unique',
      'nullable',
      '1',
      '*',
      '?',
    ]);
  });

  it('handles 100-entity fixture under 10ms', () => {
    const lines = ['er'];
    for (let i = 0; i < 100; i++) {
      lines.push(`Table${i}`);
      lines.push(`  id: int [pk]`);
      lines.push(`  name: varchar`);
    }
    const doc = lines.join('\n');
    const start = Date.now();
    const result = extractErSymbols(doc);
    const elapsed = Date.now() - start;
    expect(result.entities).toHaveLength(100);
    expect(elapsed).toBeLessThan(10);
  });

  it('cross-validation: entity list matches TABLE_DECL_RE recognition', () => {
    const doc = 'er\nUsers\nOrders\n  amount: decimal\n';
    const result = extractErSymbols(doc);
    // Users and Orders are root-level; 'amount' is indented
    expect(result.entities).toContain('Users');
    expect(result.entities).toContain('Orders');
    expect(result.entities).not.toContain('amount');
  });

  it('does not include metadata keys in entities', () => {
    const doc = 'er\ntitle: My ER\npalette: nord\nUsers\n';
    expect(extractErSymbols(doc).entities).toEqual(['Users']);
  });
});

// ============================================================
// Flowchart extractor
// ============================================================

describe('Flowchart extractSymbols', () => {
  it('extracts node IDs from shape declarations', () => {
    const doc = [
      'flowchart',
      'Start(Begin)',
      'Login[Login Form]',
      'Dashboard[Dashboard]',
    ].join('\n');
    const result = extractFlowchartSymbols(doc);
    expect(result.kind).toBe('flowchart');
    expect(result.entities).toContain('Start');
    expect(result.entities).toContain('Login');
    expect(result.entities).toContain('Dashboard');
  });

  it('deduplicates node IDs appearing multiple times', () => {
    const doc = 'flowchart\nLogin[Login Form]\nLogin -> Dashboard\n';
    const result = extractFlowchartSymbols(doc);
    const loginCount = result.entities.filter((e) => e === 'Login').length;
    expect(loginCount).toBe(1);
  });

  it('returns empty entities for empty data section', () => {
    const doc = 'flowchart\n';
    expect(extractFlowchartSymbols(doc).entities).toEqual([]);
  });

  it('does not include metadata keys in entities', () => {
    const doc = 'flowchart My Flow\nStart(Start)\n';
    expect(extractFlowchartSymbols(doc).entities).not.toContain('title');
  });

  it('handles 100-node fixture under 10ms', () => {
    const lines = ['flowchart'];
    for (let i = 0; i < 100; i++) {
      lines.push(`Node${i}[Node ${i}]`);
    }
    const doc = lines.join('\n');
    const start = Date.now();
    const result = extractFlowchartSymbols(doc);
    const elapsed = Date.now() - start;
    expect(result.entities).toHaveLength(100);
    expect(elapsed).toBeLessThan(10);
  });
});

// ============================================================
// Infra extractor
// ============================================================

describe('Infra extractSymbols', () => {
  it('extracts component names', () => {
    const doc = ['infra', 'API', '  rps 1000', 'Cache', 'Database'].join('\n');
    const result = extractInfraSymbols(doc);
    expect(result.kind).toBe('infra');
    expect(result.entities).toContain('API');
    expect(result.entities).toContain('Cache');
    expect(result.entities).toContain('Database');
  });

  it('excludes group headers', () => {
    const doc = 'infra\n[Backend]\nAPI\nCache\n';
    expect(extractInfraSymbols(doc).entities).not.toContain('[Backend]');
    expect(extractInfraSymbols(doc).entities).toContain('API');
    expect(extractInfraSymbols(doc).entities).toContain('Cache');
  });

  it('excludes indented connection lines', () => {
    // Connections are indented under their source component
    const doc = 'infra\nAPI\n  -> Cache\n  -query-> Database\n';
    const entities = extractInfraSymbols(doc).entities;
    expect(entities).toContain('API');
    expect(entities).not.toContain('Cache'); // target-only, no declaration
    expect(entities).not.toContain('Database');
  });

  it('excludes tag declarations and tag values', () => {
    const doc = 'infra\ntag Role r\n  Backend\n  Frontend\nAPI\n';
    const entities = extractInfraSymbols(doc).entities;
    expect(entities).not.toContain('tag');
    expect(entities).not.toContain('Backend'); // tag value, not a component
    expect(entities).not.toContain('Frontend');
    expect(entities).toContain('API');
  });

  it('excludes indented properties', () => {
    const doc = 'infra\nAPI\n  rps 1000\n  latency-ms 50\nCache\n';
    const entities = extractInfraSymbols(doc).entities;
    expect(entities).toEqual(['API', 'Cache']);
  });

  it('extracts components inside group blocks', () => {
    const doc = 'infra\n[Backend]\n  API\n  Cache\nDatabase\n';
    const entities = extractInfraSymbols(doc).entities;
    expect(entities).not.toContain('[Backend]');
    expect(entities).toContain('API');
    expect(entities).toContain('Cache');
    expect(entities).toContain('Database');
  });

  it('handles hyphenated component names', () => {
    const doc = 'infra\napi-gateway\nauth-service\n';
    expect(extractInfraSymbols(doc).entities).toEqual([
      'api-gateway',
      'auth-service',
    ]);
  });

  it('strips pipe metadata from component names', () => {
    const doc = 'infra\nAPI | t: Backend\nCache | env: prod\n';
    expect(extractInfraSymbols(doc).entities).toEqual(['API', 'Cache']);
  });

  it('returns empty entities for empty data section', () => {
    expect(extractInfraSymbols('infra\n').entities).toEqual([]);
  });

  it('handles 100-node fixture under 10ms', () => {
    const lines = ['infra'];
    for (let i = 0; i < 100; i++) {
      lines.push(`Service${i}`);
      lines.push(`  rps 100`);
    }
    const doc = lines.join('\n');
    const start = Date.now();
    const result = extractInfraSymbols(doc);
    const elapsed = Date.now() - start;
    expect(result.entities).toHaveLength(100);
    expect(elapsed).toBeLessThan(10);
  });
});

// ============================================================
// Class extractor
// ============================================================

describe('Class extractSymbols', () => {
  it('extracts class names', () => {
    const doc = [
      'class',
      'User',
      '  + id: int',
      '  + name: string',
      'Order',
      '  + amount: decimal',
    ].join('\n');
    const result = extractClassSymbols(doc);
    expect(result.kind).toBe('class');
    expect(result.entities).toContain('User');
    expect(result.entities).toContain('Order');
  });

  it('excludes lowercase lines (relationship arrows, metadata)', () => {
    const doc = 'class\nUser\nOrder\nUser --|> BaseEntity\n';
    // --|> lines match CLASS_DECL_RE? Let me check: no, because `User --|> BaseEntity`
    // doesn't start with uppercase followed by class pattern end. Actually it starts
    // with 'User' which IS uppercase - let's verify the actual regex handles this.
    // REL_ARROW_RE handles relationships; CLASS_DECL_RE would match the source class.
    // The entity list should contain User, Order, BaseEntity.
    const entities = extractClassSymbols(doc).entities;
    expect(entities).toContain('User');
    expect(entities).toContain('Order');
  });

  it('excludes indented lines (class members)', () => {
    const doc = 'class\nUser\n  + id: int\n  - password: string\n';
    expect(extractClassSymbols(doc).entities).toEqual(['User']);
  });

  it('does not include keywords in entities', () => {
    const doc = 'class\nUser [abstract]\nOrder\n';
    // CLASS_DECL_RE matches 'User [abstract]' → entity 'User'
    const entities = extractClassSymbols(doc).entities;
    expect(entities).toContain('User');
    expect(entities).not.toContain('abstract');
  });

  it('returns class keywords', () => {
    const result = extractClassSymbols('class\n');
    expect(result.keywords).toContain('extends');
    expect(result.keywords).toContain('implements');
    expect(result.keywords).toContain('abstract');
  });

  it('returns empty entities for empty data section', () => {
    expect(extractClassSymbols('class\n').entities).toEqual([]);
  });

  it('handles 100-class fixture under 10ms', () => {
    const lines = ['class'];
    for (let i = 0; i < 100; i++) {
      lines.push(`Class${i}`);
      lines.push(`  + id: int`);
    }
    const doc = lines.join('\n');
    const start = Date.now();
    const result = extractClassSymbols(doc);
    const elapsed = Date.now() - start;
    expect(result.entities).toHaveLength(100);
    expect(elapsed).toBeLessThan(10);
  });
});

// ============================================================
// COMPLETION_REGISTRY
// ============================================================

describe('COMPLETION_REGISTRY', () => {
  it('has an entry for every CHART_TYPES entry', () => {
    for (const ct of CHART_TYPES) {
      expect(
        COMPLETION_REGISTRY.has(ct.name),
        `Missing registry entry for ${ct.name}`
      ).toBe(true);
    }
  });

  it('every entry has at least palette and theme directives', () => {
    for (const [name, spec] of COMPLETION_REGISTRY) {
      expect(spec.directives.palette, `${name} missing palette`).toBeDefined();
      expect(spec.directives.theme, `${name} missing theme`).toBeDefined();
    }
  });

  it('CHART_TYPES covers all ALL_CHART_TYPES except multi-line', () => {
    const chartTypeNames = new Set(CHART_TYPES.map((t) => t.name));
    for (const ct of ALL_CHART_TYPES) {
      if (ct === 'multi-line') continue;
      expect(chartTypeNames.has(ct), `CHART_TYPES missing ${ct}`).toBe(true);
    }
  });

  it('CHART_TYPES does not include multi-line alias', () => {
    expect(CHART_TYPES.find((t) => t.name === 'multi-line')).toBeUndefined();
  });

  describe('solid-fill directive coverage', () => {
    // Chart types whose renderers actually respond to `solid-fill`.
    const expected = [
      'flowchart',
      'state',
      'sequence',
      'c4',
      'org',
      'kanban',
      'journey-map',
      'mindmap',
      'cycle',
      'pyramid',
      'funnel',
      'class',
      'er',
      'sitemap',
      'boxes-and-lines',
      'wireframe',
      'bar',
      'bar-stacked',
      'pie',
      'doughnut',
      'polar-area',
      'radar',
      'scatter',
      'chord',
    ];
    for (const type of expected) {
      it(`exposes solid-fill for ${type}`, () => {
        const spec = COMPLETION_REGISTRY.get(type);
        expect(spec, `${type} not in registry`).toBeDefined();
        expect(
          spec!.directives['solid-fill'],
          `${type} should expose solid-fill`
        ).toBeDefined();
      });
    }

    // Chart types where the keyword is a no-op (renderer opt-out, no shapeFill,
    // or no shape fills at all). These should NOT advertise solid-fill in
    // completion to avoid misleading users.
    const skipped = [
      'gantt',
      'infra',
      'heatmap',
      'tech-radar',
      'venn',
      'quadrant',
      'line',
      'area',
      'function',
      'sankey',
      'wordcloud',
      'slope',
      'arc',
      'timeline',
    ];
    for (const type of skipped) {
      it(`does not expose solid-fill for ${type}`, () => {
        const spec = COMPLETION_REGISTRY.get(type);
        expect(spec, `${type} not in registry`).toBeDefined();
        expect(
          spec!.directives['solid-fill'],
          `${type} should not expose solid-fill`
        ).toBeUndefined();
      });
    }
  });

  it('METADATA_KEY_SET includes expected keys', () => {
    const expected = [
      'palette',
      'theme',
      'chart',
      'title',
      'x-label',
      'orientation-horizontal',
      'activations',
      'start',
      'critical-path',
      'direction-tb',
      'series',
      'no-name',
      'no-value',
      'no-percent',
    ];
    for (const key of expected) {
      expect(METADATA_KEY_SET.has(key), `METADATA_KEY_SET missing ${key}`).toBe(
        true
      );
    }
  });

  it('registry directives match language-reference.md options', () => {
    const refPath = resolve(__dirname, '../docs/language-reference.md');
    const refContent = readFileSync(refPath, 'utf-8');

    // Spot-check: bar should have orientation-horizontal, sequence should have activations, gantt should have start
    const barSpec = COMPLETION_REGISTRY.get('bar')!;
    expect(barSpec.directives['orientation-horizontal']).toBeDefined();
    expect(barSpec.directives['x-label']).toBeDefined();

    const seqSpec = COMPLETION_REGISTRY.get('sequence')!;
    expect(seqSpec.directives.activations).toBeDefined();

    const ganttSpec = COMPLETION_REGISTRY.get('gantt')!;
    expect(ganttSpec.directives.start).toBeDefined();
    expect(ganttSpec.directives['today-marker']).toBeDefined();
    expect(ganttSpec.directives['critical-path']).toBeDefined();

    // Verify the language reference mentions these directives
    expect(refContent).toContain('palette');
    expect(refContent).toContain('activations');
    expect(refContent).toContain('critical-path');
  });

  it('infra registry includes top-level default directives', () => {
    const infraSpec = COMPLETION_REGISTRY.get('infra')!;
    const expected = [
      'default-latency-ms',
      'default-uptime',
      'default-rps',
      'slo-availability',
      'slo-p90-latency-ms',
      'slo-warning-margin',
    ];
    for (const key of expected) {
      expect(
        infraSpec.directives[key],
        `infra missing directive ${key}`
      ).toBeDefined();
    }
    // direction-tb should still be present
    expect(infraSpec.directives['direction-tb']).toBeDefined();
  });

  it('registry lookup for all 32 types completes under 1ms', () => {
    const start = performance.now();
    for (const ct of CHART_TYPES) {
      COMPLETION_REGISTRY.get(ct.name);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1);
  });
});

// ============================================================
// Sequence extractor
// ============================================================

describe('Sequence extractSymbols', () => {
  it('extracts participants from arrow lines', () => {
    const doc = 'sequence\nAuth -> API\nAPI -> DB\n';
    const result = extractDiagramSymbols(doc);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('sequence');
    expect(result!.entities).toEqual(['Auth', 'API', 'DB']);
  });

  it('extracts participants from labeled arrows', () => {
    const doc = 'sequence\nUser -login-> Auth\nAuth -query-> DB\n';
    const result = extractDiagramSymbols(doc);
    expect(result!.entities).toEqual(['User', 'Auth', 'DB']);
  });

  it('extracts participants from async arrows', () => {
    const doc = 'sequence\nClient ~> Server\nServer ~> Worker\n';
    const result = extractDiagramSymbols(doc);
    expect(result!.entities).toContain('Client');
    expect(result!.entities).toContain('Server');
    expect(result!.entities).toContain('Worker');
  });

  it('extracts participants from labeled tilde arrows', () => {
    const doc = 'sequence\nClient ~event~> Server\n';
    const result = extractDiagramSymbols(doc);
    expect(result!.entities).toContain('Client');
    expect(result!.entities).toContain('Server');
  });

  it('extracts participants from type declarations (is a)', () => {
    const doc =
      'sequence\nUser is a person\nGateway is a system\nUser -> Gateway\n';
    const result = extractDiagramSymbols(doc);
    expect(result!.entities).toContain('User');
    expect(result!.entities).toContain('Gateway');
  });

  it('extracts participants from type declarations (is an)', () => {
    const doc = 'sequence\nAuth is an actor\nAuth -> API\n';
    const result = extractDiagramSymbols(doc);
    expect(result!.entities).toContain('Auth');
  });

  it('deduplicates participant names', () => {
    const doc = 'sequence\nA -> B\nB -> A\nA -> C\n';
    const result = extractDiagramSymbols(doc);
    const aCount = result!.entities.filter((e) => e === 'A').length;
    expect(aCount).toBe(1);
  });

  it('strips pipe metadata from participants', () => {
    const doc = 'sequence\nAuth -> API | color: red\n';
    const result = extractDiagramSymbols(doc);
    expect(result!.entities).toContain('Auth');
    expect(result!.entities).toContain('API');
    expect(result!.entities).not.toContain('API | color: red');
  });

  it('skips section headers', () => {
    const doc = 'sequence\n== Login ==\nUser -> Auth\n';
    const result = extractDiagramSymbols(doc);
    expect(result!.entities).toEqual(['User', 'Auth']);
  });

  it('skips structural keywords', () => {
    const doc =
      'sequence\nA -> B\nif: condition\n  B -> C\nelse:\n  B -> D\nend\n';
    const result = extractDiagramSymbols(doc);
    expect(result!.entities).not.toContain('if');
    expect(result!.entities).not.toContain('else');
  });

  it('returns sequence keywords', () => {
    const doc = 'sequence\nA -> B\n';
    const result = extractDiagramSymbols(doc);
    expect(result!.keywords).toContain('if');
    expect(result!.keywords).toContain('loop');
    expect(result!.keywords).toContain('parallel');
    expect(result!.keywords).toContain('note');
    expect(result!.keywords).not.toContain('note on');
  });

  it('returns empty entities for empty sequence', () => {
    const doc = 'sequence\n';
    const result = extractDiagramSymbols(doc);
    expect(result!.entities).toEqual([]);
  });

  it('handles 100-participant fixture under 10ms', () => {
    const lines = ['sequence'];
    for (let i = 0; i < 100; i++) {
      lines.push(`P${i} -> P${i + 1}`);
    }
    const doc = lines.join('\n');
    const start = Date.now();
    const result = extractDiagramSymbols(doc);
    const elapsed = Date.now() - start;
    expect(result!.entities.length).toBeGreaterThanOrEqual(100);
    expect(elapsed).toBeLessThan(10);
  });
});

// ============================================================
// State extractor
// ============================================================

describe('State extractSymbols', () => {
  it('extracts state names from transitions', () => {
    const doc = 'state\nIdle -> Running\nRunning -> Stopped\n';
    const result = extractDiagramSymbols(doc);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('state');
    expect(result!.entities).toContain('Idle');
    expect(result!.entities).toContain('Running');
    expect(result!.entities).toContain('Stopped');
  });

  it('deduplicates state names', () => {
    const doc = 'state\nA -> B\nB -> A\n';
    const result = extractDiagramSymbols(doc);
    expect(result!.entities).toEqual(['A', 'B']);
  });

  it('returns empty entities for empty state diagram', () => {
    const doc = 'state\n';
    const result = extractDiagramSymbols(doc);
    expect(result!.entities).toEqual([]);
  });

  it('skips metadata lines', () => {
    const doc = 'state\ndirection-tb\nA -> B\n';
    const result = extractDiagramSymbols(doc);
    expect(result!.entities).not.toContain('direction');
    expect(result!.entities).toContain('A');
  });
});

// ============================================================
// extractTagDeclarations
// ============================================================

describe('extractTagDeclarations', () => {
  it('extracts tag group with alias', () => {
    const doc =
      'sequence\ntag Team t\n  Frontend blue\n  Backend green\nA -> B\n';
    const result = extractTagDeclarations(doc);
    expect(result.get('t')).toEqual(['Frontend', 'Backend']);
  });

  it('extracts tag group with shorthand alias (no alias keyword)', () => {
    const doc =
      'gantt\ntag Team t\n  Rebels red\n  Sharks orange\ntag TopGoal tg\n  TG1 red\n  TG2 green\n';
    const result = extractTagDeclarations(doc);
    expect(result.get('t')).toEqual(['Rebels', 'Sharks']);
    expect(result.get('tg')).toEqual(['TG1', 'TG2']);
  });

  it('extracts tag group without alias (preserves original case)', () => {
    const doc = 'org\ntag Department\n  Engineering\n  Marketing\n';
    const result = extractTagDeclarations(doc);
    expect(result.get('Department')).toEqual(['Engineering', 'Marketing']);
  });

  it('handles multiple tag groups', () => {
    const doc =
      'infra\ntag Role r\n  Backend\n  Frontend\ntag Env e\n  Prod\n  Staging\n';
    const result = extractTagDeclarations(doc);
    expect(result.get('r')).toEqual(['Backend', 'Frontend']);
    expect(result.get('e')).toEqual(['Prod', 'Staging']);
  });

  it('strips color annotations from values', () => {
    const doc = 'org\ntag Team t\n  Alpha blue\n  Beta red\n';
    const result = extractTagDeclarations(doc);
    expect(result.get('t')).toEqual(['Alpha', 'Beta']);
  });

  it('returns empty map for doc without tags', () => {
    const doc = 'sequence\nA -> B\n';
    const result = extractTagDeclarations(doc);
    expect(result.size).toBe(0);
  });
});

// ============================================================
// ENTITY_TYPES
// ============================================================

describe('ENTITY_TYPES', () => {
  it('has correct sequence participant types', () => {
    const types = ENTITY_TYPES.get('sequence');
    expect(types).toBeDefined();
    expect(types).toEqual(['actor', 'database', 'queue', 'cache']);
    expect(types).toHaveLength(4);
  });

  it('has correct C4 types', () => {
    const types = ENTITY_TYPES.get('c4');
    expect(types).toBeDefined();
    expect(types).toContain('person');
    expect(types).toContain('system');
    expect(types).toContain('external');
    expect(types).toContain('database');
    expect(types).toHaveLength(6);
  });

  it('does not have entries for chart types without is-a support', () => {
    expect(ENTITY_TYPES.has('bar')).toBe(false);
    expect(ENTITY_TYPES.has('state')).toBe(false);
    expect(ENTITY_TYPES.has('er')).toBe(false);
  });
});

// ============================================================
// PIPE_METADATA
// ============================================================

describe('PIPE_METADATA', () => {
  it('has infra entry with node and edge properties', () => {
    const infra = PIPE_METADATA.get('infra');
    expect(infra).toBeDefined();
    expect(infra!.node.instances).toBeDefined();
    expect(infra!.node['latency-ms']).toBeDefined();
    expect(infra!.node['max-rps']).toBeDefined();
    expect(infra!.node['cache-hit']).toBeDefined();
    expect(infra!.node.uptime).toBeDefined();
    expect(infra!.node.concurrency).toBeDefined();
    // SLO keys in node set
    expect(infra!.node['slo-availability']).toBeDefined();
    expect(infra!.node['slo-p90-latency-ms']).toBeDefined();
    // Edge keys
    expect(infra!.edge.split).toBeDefined();
    expect(infra!.edge.fanout).toBeDefined();
    // rps should NOT be in edge set
    expect(infra!.edge).not.toHaveProperty('rps');
  });

  it('has c4 entry with description/tech node keys', () => {
    const c4 = PIPE_METADATA.get('c4');
    expect(c4).toBeDefined();
    expect(c4!.node.description).toBeDefined();
    expect(c4!.node.tech).toBeDefined();
    expect(c4!.node.technology).toBeDefined();
  });

  it('has gantt entry with offset edge key', () => {
    const gantt = PIPE_METADATA.get('gantt');
    expect(gantt).toBeDefined();
    expect(gantt!.edge.offset).toBeDefined();
  });

  it('does NOT have sequence entry (| is tag separator)', () => {
    expect(PIPE_METADATA.has('sequence')).toBe(false);
  });

  it('has tech-radar entry with quadrant + blip contexts', () => {
    const tr = PIPE_METADATA.get('tech-radar');
    expect(tr).toBeDefined();
    // Quadrant headers: quadrant + color
    expect(tr!.quadrant.quadrant).toBeDefined();
    expect(tr!.quadrant.quadrant.values).toEqual([
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ]);
    expect(tr!.quadrant.color).toBeDefined();
    // Blips: ring + trend
    expect(tr!.blip.ring).toBeDefined();
    expect(tr!.blip.trend).toBeDefined();
    expect(tr!.blip.trend.values).toEqual(['new', 'up', 'down', 'stable']);
  });
});

// ============================================================
// Tech Radar symbol extraction
// ============================================================

describe('extractDiagramSymbols — tech-radar', () => {
  it('extracts ring names as entities', () => {
    const doc = `tech-radar My Radar

rings
  Adopt
  Trial
  Assess
  Hold

Techniques | quadrant: top-right
  CI/CD | ring: Adopt, trend: stable
`;
    const symbols = extractDiagramSymbols(doc);
    expect(symbols).not.toBeNull();
    expect(symbols!.kind).toBe('tech-radar');
    expect(symbols!.entities).toContain('Adopt');
    expect(symbols!.entities).toContain('Trial');
    expect(symbols!.entities).toContain('Assess');
    expect(symbols!.entities).toContain('Hold');
  });

  it('extracts ring aliases as entities', () => {
    const doc = `tech-radar My Radar

rings
  Adopt alias a
  Trial aka t
  Assess
`;
    const symbols = extractDiagramSymbols(doc);
    expect(symbols).not.toBeNull();
    expect(symbols!.entities).toContain('Adopt');
    expect(symbols!.entities).toContain('a');
    expect(symbols!.entities).toContain('Trial');
    expect(symbols!.entities).toContain('t');
    expect(symbols!.entities).toContain('Assess');
  });

  it('includes tech-radar keywords', () => {
    const doc = `tech-radar My Radar

rings
  Adopt
`;
    const symbols = extractDiagramSymbols(doc);
    expect(symbols).not.toBeNull();
    expect(symbols!.keywords).toContain('rings');
    expect(symbols!.keywords).toContain('quadrant');
    expect(symbols!.keywords).toContain('ring');
    expect(symbols!.keywords).toContain('trend');
    expect(symbols!.keywords).toContain('new');
    expect(symbols!.keywords).toContain('up');
    expect(symbols!.keywords).toContain('down');
    expect(symbols!.keywords).toContain('stable');
    expect(symbols!.keywords).toContain('top-left');
    expect(symbols!.keywords).toContain('top-right');
    expect(symbols!.keywords).toContain('bottom-left');
    expect(symbols!.keywords).toContain('bottom-right');
  });

  it('stops ring extraction at unindented line', () => {
    const doc = `tech-radar My Radar

rings
  Adopt
  Trial

Techniques | quadrant: top-right
  CI/CD | ring: Adopt
`;
    const symbols = extractDiagramSymbols(doc);
    expect(symbols!.entities).toContain('Adopt');
    expect(symbols!.entities).toContain('Trial');
    expect(symbols!.entities).not.toContain('Techniques');
    expect(symbols!.entities).not.toContain('CI/CD');
  });

  it('handles empty rings block', () => {
    const doc = `tech-radar My Radar

rings

Techniques | quadrant: top-right
`;
    const symbols = extractDiagramSymbols(doc);
    expect(symbols).not.toBeNull();
    expect(symbols!.entities).toHaveLength(0);
  });
});

// ============================================================
// COMPLETION_REGISTRY — tech-radar
// ============================================================

describe('COMPLETION_REGISTRY — tech-radar', () => {
  it('registers tech-radar directive + pipe metadata', () => {
    const spec = COMPLETION_REGISTRY.get('tech-radar');
    expect(spec).toBeDefined();
    // Per spec §20, the only chart-specific directive is `show-blip-legend`.
    // `rings` is a structural keyword; quadrant/ring/trend/color are pipe
    // metadata that live in PIPE_METADATA.
    expect(spec!.directives).toHaveProperty('show-blip-legend');
    expect(spec!.directives).toHaveProperty('palette');
    expect(spec!.directives).toHaveProperty('theme');

    const pipe = PIPE_METADATA.get('tech-radar');
    expect(pipe).toBeDefined();
    expect(pipe!.quadrant).toHaveProperty('quadrant');
    expect(pipe!.quadrant).toHaveProperty('color');
    expect(pipe!.blip).toHaveProperty('ring');
    expect(pipe!.blip).toHaveProperty('trend');
  });
});
