import { describe, it, expect } from 'vitest';
import { classifyEREntities } from '../src/er/classify';
import type { ERTable, ERRelationship } from '../src/er/types';

// ── Test helpers ────────────────────────────────────────────────────────────

function makeTable(
  id: string,
  cols: Array<{
    name: string;
    constraints: ('pk' | 'fk' | 'unique' | 'nullable')[];
  }>
): ERTable {
  return {
    id,
    name: id,
    columns: cols.map((c, i) => ({
      name: c.name,
      constraints: c.constraints,
      lineNumber: i + 1,
    })),
    metadata: {},
    lineNumber: 1,
  };
}

function makeNamedTable(
  id: string,
  name: string,
  cols: Array<{
    name: string;
    constraints: ('pk' | 'fk' | 'unique' | 'nullable')[];
  }>
): ERTable {
  return { ...makeTable(id, cols), name };
}

function makeRel(
  source: string,
  target: string,
  from: '1' | '*' | '?',
  to: '1' | '*' | '?'
): ERRelationship {
  return { source, target, cardinality: { from, to }, lineNumber: 1 };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('classifyEREntities', () => {
  describe('core', () => {
    it('classifies a table with PK and no FKs as core', () => {
      const tables = [
        makeTable('users', [{ name: 'id', constraints: ['pk'] }]),
      ];
      const result = classifyEREntities(tables, []);
      expect(result.get('users')).toBe('core');
    });

    it('classifies a table with no columns as core', () => {
      const tables = [makeTable('things', [])];
      const result = classifyEREntities(tables, []);
      expect(result.get('things')).toBe('core');
    });
  });

  describe('dependent', () => {
    it('classifies a table with PK + 1 FK as dependent', () => {
      const tables = [
        makeTable('posts', [
          { name: 'id', constraints: ['pk'] },
          { name: 'author_id', constraints: ['fk'] },
          { name: 'title', constraints: [] },
        ]),
      ];
      const result = classifyEREntities(tables, []);
      expect(result.get('posts')).toBe('dependent');
    });
  });

  describe('junction — ratio signal', () => {
    it('classifies a table where FK/total ≥ 0.6 as junction', () => {
      // 3 FK out of 4 columns = 0.75
      const tables = [
        makeTable('order_items', [
          { name: 'id', constraints: ['pk'] },
          { name: 'order_id', constraints: ['fk'] },
          { name: 'product_id', constraints: ['fk'] },
          { name: 'warehouse_id', constraints: ['fk'] },
        ]),
      ];
      const result = classifyEREntities(tables, []);
      expect(result.get('order_items')).toBe('junction');
    });

    it('classifies a table with FK/total exactly 0.6 as junction', () => {
      // 3 FK out of 5 columns = 0.6
      const tables = [
        makeTable('j', [
          { name: 'a_id', constraints: ['fk'] },
          { name: 'b_id', constraints: ['fk'] },
          { name: 'c_id', constraints: ['fk'] },
          { name: 'x', constraints: [] },
          { name: 'y', constraints: [] },
        ]),
      ];
      const result = classifyEREntities(tables, []);
      expect(result.get('j')).toBe('junction');
    });
  });

  describe('junction — composite PK signal', () => {
    it('classifies a table with composite PK FKs referencing 2+ tables as junction', () => {
      const tables = [
        makeTable('order_product', [
          { name: 'order_id', constraints: ['pk', 'fk'] },
          { name: 'product_id', constraints: ['pk', 'fk'] },
        ]),
        makeTable('orders', [{ name: 'id', constraints: ['pk'] }]),
        makeTable('products', [{ name: 'id', constraints: ['pk'] }]),
      ];
      const rels = [
        makeRel('orders', 'order_product', '1', '*'),
        makeRel('products', 'order_product', '1', '*'),
      ];
      const result = classifyEREntities(tables, rels);
      expect(result.get('order_product')).toBe('junction');
    });
  });

  describe('junction — M:M graph signal', () => {
    it('classifies a table that sits between two 1:many relationships as junction', () => {
      // order_items has surrogate PK + 2 FK columns — FK ratio = 0.5 (not ≥ 0.6)
      // but it has * cardinality to 2 distinct tables → mmParticipant
      const tables = [
        makeTable('order_items', [
          { name: 'id', constraints: ['pk'] },
          { name: 'order_id', constraints: ['fk'] },
          { name: 'product_id', constraints: ['fk'] },
          { name: 'quantity', constraints: [] },
        ]),
        makeTable('orders', [{ name: 'id', constraints: ['pk'] }]),
        makeTable('products', [{ name: 'id', constraints: ['pk'] }]),
      ];
      // orders 1--* order_items, products 1--* order_items
      const rels = [
        makeRel('orders', 'order_items', '1', '*'),
        makeRel('products', 'order_items', '1', '*'),
      ];
      const result = classifyEREntities(tables, rels);
      expect(result.get('order_items')).toBe('junction');
    });
  });

  describe('ambiguous', () => {
    it('classifies a table with FK ratio 0.4–0.59 as ambiguous', () => {
      // 2 FK out of 5 = 0.4
      const tables = [
        makeTable('bridge', [
          { name: 'id', constraints: ['pk'] },
          { name: 'a_id', constraints: ['fk'] },
          { name: 'b_id', constraints: ['fk'] },
          { name: 'x', constraints: [] },
          { name: 'y', constraints: [] },
        ]),
      ];
      const result = classifyEREntities(tables, []);
      expect(result.get('bridge')).toBe('ambiguous');
    });

    it('does NOT classify as ambiguous if FK ratio < 0.4', () => {
      // 1 FK out of 5 = 0.2
      const tables = [
        makeTable('t', [
          { name: 'id', constraints: ['pk'] },
          { name: 'a_id', constraints: ['fk'] },
          { name: 'x', constraints: [] },
          { name: 'y', constraints: [] },
          { name: 'z', constraints: [] },
        ]),
      ];
      const result = classifyEREntities(tables, []);
      expect(result.get('t')).toBe('dependent'); // not ambiguous
    });
  });

  describe('self-referential', () => {
    it('classifies a table with a FK only to itself as self-referential', () => {
      const tables = [
        makeTable('categories', [
          { name: 'id', constraints: ['pk'] },
          { name: 'parent_id', constraints: ['fk'] },
        ]),
      ];
      // Self-loop relationship
      const rels = [makeRel('categories', 'categories', '1', '*')];
      const result = classifyEREntities(tables, rels);
      expect(result.get('categories')).toBe('self-referential');
    });

    it('does NOT classify as self-referential when table also has external FK relationships', () => {
      // Has self-loop AND external FK → junction (or other) wins
      const tables = [
        makeTable('nodes', [
          { name: 'id', constraints: ['pk'] },
          { name: 'parent_id', constraints: ['fk'] },
          { name: 'graph_id', constraints: ['fk'] },
        ]),
        makeTable('graphs', [{ name: 'id', constraints: ['pk'] }]),
      ];
      const rels = [
        makeRel('nodes', 'nodes', '1', '*'),
        makeRel('graphs', 'nodes', '1', '*'),
      ];
      const result = classifyEREntities(tables, rels);
      // has external relationship so not self-referential; 2 FK / 3 cols = 0.67 → junction
      expect(result.get('nodes')).not.toBe('self-referential');
    });
  });

  describe('lookup', () => {
    it('classifies a *_type table with ≤ 6 cols, ≤ 1 FK, referenced by others as lookup', () => {
      const tables = [
        makeNamedTable('order_status', 'order_status', [
          { name: 'id', constraints: ['pk'] },
          { name: 'code', constraints: [] },
          { name: 'label', constraints: [] },
        ]),
        makeTable('orders', [
          { name: 'id', constraints: ['pk'] },
          { name: 'status_id', constraints: ['fk'] },
        ]),
      ];
      // orders *--1 order_status (order_status is on the 1 side → indegree++)
      const rels = [makeRel('orders', 'order_status', '*', '1')];
      const result = classifyEREntities(tables, rels);
      expect(result.get('order_status')).toBe('lookup');
    });

    it('does NOT classify a *_type table with > 6 cols as lookup (structure overrides naming)', () => {
      const tables = [
        makeNamedTable('order_status', 'order_status', [
          { name: 'id', constraints: ['pk'] },
          { name: 'c1', constraints: [] },
          { name: 'c2', constraints: [] },
          { name: 'c3', constraints: [] },
          { name: 'c4', constraints: [] },
          { name: 'c5', constraints: [] },
          { name: 'c6', constraints: [] },
          { name: 'c7', constraints: [] },
          { name: 'c8', constraints: [] },
          { name: 'c9', constraints: [] },
          { name: 'c10', constraints: [] },
          { name: 'c11', constraints: [] },
        ]),
        makeTable('orders', [
          { name: 'id', constraints: ['pk'] },
          { name: 'status_id', constraints: ['fk'] },
        ]),
      ];
      const rels = [makeRel('orders', 'order_status', '*', '1')];
      const result = classifyEREntities(tables, rels);
      // 12 columns → col guard fails → not lookup
      expect(result.get('order_status')).not.toBe('lookup');
    });
  });

  describe('hub', () => {
    it('classifies a high-indegree table as hub in a schema of ≥ 6 tables', () => {
      // users is referenced by 5 other tables → high indegree outlier
      const tables = [
        makeTable('users', [{ name: 'id', constraints: ['pk'] }]),
        makeTable('posts', [
          { name: 'id', constraints: ['pk'] },
          { name: 'user_id', constraints: ['fk'] },
        ]),
        makeTable('comments', [
          { name: 'id', constraints: ['pk'] },
          { name: 'user_id', constraints: ['fk'] },
        ]),
        makeTable('likes', [
          { name: 'id', constraints: ['pk'] },
          { name: 'user_id', constraints: ['fk'] },
        ]),
        makeTable('messages', [
          { name: 'id', constraints: ['pk'] },
          { name: 'user_id', constraints: ['fk'] },
        ]),
        makeTable('sessions', [
          { name: 'id', constraints: ['pk'] },
          { name: 'user_id', constraints: ['fk'] },
        ]),
      ];
      const rels = [
        makeRel('users', 'posts', '1', '*'),
        makeRel('users', 'comments', '1', '*'),
        makeRel('users', 'likes', '1', '*'),
        makeRel('users', 'messages', '1', '*'),
        makeRel('users', 'sessions', '1', '*'),
      ];
      const result = classifyEREntities(tables, rels);
      expect(result.get('users')).toBe('hub');
    });

    it('does NOT classify as hub when schema has < 6 tables (size guard)', () => {
      // Same pattern but only 4 tables
      const tables = [
        makeTable('users', [{ name: 'id', constraints: ['pk'] }]),
        makeTable('posts', [
          { name: 'id', constraints: ['pk'] },
          { name: 'user_id', constraints: ['fk'] },
        ]),
        makeTable('comments', [
          { name: 'id', constraints: ['pk'] },
          { name: 'user_id', constraints: ['fk'] },
        ]),
        makeTable('likes', [
          { name: 'id', constraints: ['pk'] },
          { name: 'user_id', constraints: ['fk'] },
        ]),
      ];
      const rels = [
        makeRel('users', 'posts', '1', '*'),
        makeRel('users', 'comments', '1', '*'),
        makeRel('users', 'likes', '1', '*'),
      ];
      const result = classifyEREntities(tables, rels);
      // Only 4 tables → hub guard fires → not hub → core (users has no FK cols)
      expect(result.get('users')).not.toBe('hub');
      expect(result.get('users')).toBe('core');
    });
  });

  describe('inheritance pattern (AC-11)', () => {
    it('classifies a table with composite PK FKs all targeting the same parent as dependent, not junction', () => {
      // ClassB inherits ClassA — composite PK [a_id, b_id] both point to ClassA
      const tables = [
        makeTable('class_a', [{ name: 'id', constraints: ['pk'] }]),
        makeTable('class_b', [
          { name: 'a_id', constraints: ['pk', 'fk'] },
          { name: 'b_id', constraints: ['pk', 'fk'] },
          { name: 'extra', constraints: [] },
        ]),
      ];
      // Both FKs in class_b point to class_a (single external target)
      const rels = [makeRel('class_a', 'class_b', '1', '*')];
      const result = classifyEREntities(tables, rels);
      expect(result.get('class_b')).toBe('dependent');
    });
  });

  describe('empty input', () => {
    it('returns empty map for empty table list', () => {
      const result = classifyEREntities([], []);
      expect(result.size).toBe(0);
    });
  });
});
