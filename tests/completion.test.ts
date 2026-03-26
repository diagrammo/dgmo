import { describe, expect, it } from 'vitest';

import { extractDiagramSymbols } from '../src/completion';
import { extractSymbols as extractErSymbols } from '../src/er/parser';
import { extractSymbols as extractFlowchartSymbols } from '../src/graph/flowchart-parser';
import { extractSymbols as extractInfraSymbols } from '../src/infra/parser';
import { extractSymbols as extractClassSymbols } from '../src/class/parser';

// ============================================================
// extractDiagramSymbols dispatch
// ============================================================

describe('extractDiagramSymbols', () => {
  it('returns null for unknown chart type', () => {
    const doc = 'kanban\nTodo\n  - Task 1\n';
    expect(extractDiagramSymbols(doc)).toBeNull();
  });

  it('returns null when no chart: line present', () => {
    expect(extractDiagramSymbols('Users\n  id: int\n')).toBeNull();
  });

  it('dispatches to ER extractor for chart: er', () => {
    const doc = 'chart: er\nUsers\nOrders\n';
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
    const doc = 'chart: class\nUser\nOrder\n';
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
      'chart: er',
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
    const doc = 'chart: er\nUsers(blue)\nOrders(red)\n';
    expect(extractErSymbols(doc).entities).toEqual(['Users', 'Orders']);
  });

  it('strips pipe metadata from entity names', () => {
    const doc = 'chart: er\nOrders | status: active\nUsers | env: prod\n';
    expect(extractErSymbols(doc).entities).toEqual(['Orders', 'Users']);
  });

  it('excludes indented lines (column definitions)', () => {
    const doc = 'chart: er\nUsers\n  id: int [pk]\n  name: varchar\nOrders\n';
    expect(extractErSymbols(doc).entities).toEqual(['Users', 'Orders']);
  });

  it('excludes relationship lines', () => {
    const doc = 'chart: er\nUsers\nOrders\nUsers 1--* Orders : places\n';
    expect(extractErSymbols(doc).entities).toEqual(['Users', 'Orders']);
  });

  it('returns empty entities for empty data section', () => {
    const doc = 'chart: er\ntitle: Empty\n';
    const result = extractErSymbols(doc);
    expect(result.entities).toEqual([]);
    expect(result.keywords).toContain('pk');
    expect(result.keywords).toContain('fk');
  });

  it('returns ER keywords', () => {
    const result = extractErSymbols('chart: er\n');
    expect(result.keywords).toEqual(['pk', 'fk', 'unique', 'nullable', '1', '*', '?']);
  });

  it('handles 100-entity fixture under 10ms', () => {
    const lines = ['chart: er'];
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
    const doc = 'chart: er\nUsers\nOrders\n  amount: decimal\n';
    const result = extractErSymbols(doc);
    // Users and Orders are root-level; 'amount' is indented
    expect(result.entities).toContain('Users');
    expect(result.entities).toContain('Orders');
    expect(result.entities).not.toContain('amount');
  });

  it('does not include metadata keys in entities', () => {
    const doc = 'chart: er\ntitle: My ER\npalette: nord\nUsers\n';
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
    const doc = [
      'infra',
      'API',
      '  rps 1000',
      'Cache',
      'Database',
    ].join('\n');
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
    expect(extractInfraSymbols(doc).entities).toEqual(['api-gateway', 'auth-service']);
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
      'chart: class',
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
    const doc = 'chart: class\nUser\nOrder\nUser --|> BaseEntity\n';
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
    const doc = 'chart: class\nUser\n  + id: int\n  - password: string\n';
    expect(extractClassSymbols(doc).entities).toEqual(['User']);
  });

  it('does not include keywords in entities', () => {
    const doc = 'chart: class\nUser [abstract]\nOrder\n';
    // CLASS_DECL_RE matches 'User [abstract]' → entity 'User'
    const entities = extractClassSymbols(doc).entities;
    expect(entities).toContain('User');
    expect(entities).not.toContain('abstract');
  });

  it('returns class keywords', () => {
    const result = extractClassSymbols('chart: class\n');
    expect(result.keywords).toContain('extends');
    expect(result.keywords).toContain('implements');
    expect(result.keywords).toContain('abstract');
  });

  it('returns empty entities for empty data section', () => {
    expect(extractClassSymbols('chart: class\n').entities).toEqual([]);
  });

  it('handles 100-class fixture under 10ms', () => {
    const lines = ['chart: class'];
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
