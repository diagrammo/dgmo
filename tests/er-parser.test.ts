import { describe, it, expect } from 'vitest';
import { parseERDiagram, looksLikeERDiagram } from '../src/er/parser';

describe('parseERDiagram', () => {
  // === Metadata ===
  describe('metadata', () => {
    it('parses chart: er', () => {
      const result = parseERDiagram('chart: er\nusers\n  id: int [pk]');
      expect(result.type).toBe('er');
      expect(result.error).toBeNull();
      expect(result.diagnostics).toEqual([]);
    });

    it('rejects wrong chart type', () => {
      const result = parseERDiagram('chart: flowchart\nusers\n  id: int [pk]');
      expect(result.error).toContain('Expected chart type "er"');
      // diagnostics
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toMatch(/Expected chart type "er"/);
      expect(result.diagnostics[0].severity).toBe('error');
      expect(result.diagnostics[0].line).toBeGreaterThanOrEqual(0);
    });

    it('parses title', () => {
      const result = parseERDiagram('chart: er\ntitle: Blog Platform\nusers\n  id: int [pk]');
      expect(result.title).toBe('Blog Platform');
      expect(result.titleLineNumber).toBe(2);
    });

    it('parses notation option', () => {
      const result = parseERDiagram('chart: er\nnotation: labels\nusers\n  id: int [pk]');
      expect(result.options.notation).toBe('labels');
    });
  });

  // === Comments ===
  describe('comments', () => {
    it('ignores // comments', () => {
      const result = parseERDiagram('// this is a comment\nusers\n  id: int [pk]');
      expect(result.error).toBeNull();
      expect(result.tables).toHaveLength(1);
    });
  });

  // === Table declarations ===
  describe('table declarations', () => {
    it('parses simple table', () => {
      const result = parseERDiagram('users\n  id: int [pk]');
      expect(result.tables).toHaveLength(1);
      expect(result.tables[0].name).toBe('users');
      expect(result.tables[0].id).toBe('users');
    });

    it('parses table with color', () => {
      const result = parseERDiagram('users (red)\n  id: int [pk]');
      expect(result.tables[0].color).toBeDefined();
    });

    it('parses table with underscore name', () => {
      const result = parseERDiagram('user_roles\n  id: int [pk]');
      expect(result.tables[0].name).toBe('user_roles');
    });

    it('tracks line numbers', () => {
      const result = parseERDiagram('chart: er\ntitle: Test\n\nusers\n  id: int [pk]');
      expect(result.tables[0].lineNumber).toBe(4);
    });

    it('handles table with no columns', () => {
      const result = parseERDiagram('users');
      expect(result.tables).toHaveLength(1);
      expect(result.tables[0].columns).toHaveLength(0);
    });
  });

  // === Columns ===
  describe('columns', () => {
    it('parses column with name and type', () => {
      const result = parseERDiagram('users\n  name: varchar');
      const col = result.tables[0].columns[0];
      expect(col.name).toBe('name');
      expect(col.type).toBe('varchar');
      expect(col.constraints).toHaveLength(0);
    });

    it('parses column with name only', () => {
      const result = parseERDiagram('users\n  active');
      const col = result.tables[0].columns[0];
      expect(col.name).toBe('active');
      expect(col.type).toBeUndefined();
    });

    it('parses column with pk constraint', () => {
      const result = parseERDiagram('users\n  id: int [pk]');
      const col = result.tables[0].columns[0];
      expect(col.constraints).toContain('pk');
    });

    it('parses column with fk constraint', () => {
      const result = parseERDiagram('posts\n  author_id: int [fk]');
      const col = result.tables[0].columns[0];
      expect(col.constraints).toContain('fk');
    });

    it('parses column with unique constraint', () => {
      const result = parseERDiagram('users\n  email: varchar [unique]');
      const col = result.tables[0].columns[0];
      expect(col.constraints).toContain('unique');
    });

    it('parses column with nullable constraint', () => {
      const result = parseERDiagram('users\n  bio: text [nullable]');
      const col = result.tables[0].columns[0];
      expect(col.constraints).toContain('nullable');
    });

    it('parses column with multiple constraints', () => {
      const result = parseERDiagram('users\n  id: int [pk, unique]');
      const col = result.tables[0].columns[0];
      expect(col.constraints).toContain('pk');
      expect(col.constraints).toContain('unique');
    });

    it('tracks column line numbers', () => {
      const result = parseERDiagram('users\n  id: int [pk]\n  name: varchar');
      expect(result.tables[0].columns[0].lineNumber).toBe(2);
      expect(result.tables[0].columns[1].lineNumber).toBe(3);
    });

    it('parses multiple columns', () => {
      const result = parseERDiagram('users\n  id: int [pk]\n  name: varchar\n  email: varchar [unique]');
      expect(result.tables[0].columns).toHaveLength(3);
    });
  });

  // === Relationships ===
  describe('relationships', () => {
    describe('symbolic cardinality', () => {
      it('parses 1--* (one-to-many)', () => {
        const result = parseERDiagram('users\n  id: int [pk]\n\nposts\n  id: int [pk]\n\nusers 1--* posts');
        expect(result.relationships).toHaveLength(1);
        expect(result.relationships[0].cardinality.from).toBe('1');
        expect(result.relationships[0].cardinality.to).toBe('*');
      });

      it('parses 1-* (one-to-many, single dash)', () => {
        const result = parseERDiagram('users\n  id: int [pk]\n\nposts\n  id: int [pk]\n\nusers 1-* posts');
        expect(result.relationships[0].cardinality.from).toBe('1');
        expect(result.relationships[0].cardinality.to).toBe('*');
      });

      it('parses ?--1 (zero-or-one to one)', () => {
        const result = parseERDiagram('users\n  id: int [pk]\n\nprofiles\n  id: int [pk]\n\nusers ?--1 profiles');
        expect(result.relationships[0].cardinality.from).toBe('?');
        expect(result.relationships[0].cardinality.to).toBe('1');
      });

      it('parses 1--1 (one-to-one)', () => {
        const result = parseERDiagram('users\n  id: int [pk]\n\nprofiles\n  id: int [pk]\n\nusers 1--1 profiles');
        expect(result.relationships[0].cardinality.from).toBe('1');
        expect(result.relationships[0].cardinality.to).toBe('1');
      });

      it('parses *--* (many-to-many)', () => {
        const result = parseERDiagram('students\n  id: int [pk]\n\ncourses\n  id: int [pk]\n\nstudents *--* courses');
        expect(result.relationships[0].cardinality.from).toBe('*');
        expect(result.relationships[0].cardinality.to).toBe('*');
      });
    });

    describe('keyword cardinality (rejected with helpful error)', () => {
      it('rejects one-to-many with symbolic suggestion', () => {
        const result = parseERDiagram('users\n  id: int [pk]\n\nposts\n  id: int [pk]\n\nusers one-to-many posts');
        expect(result.error).toBeTruthy();
        expect(result.diagnostics[0].message).toContain('1--*');
        expect(result.relationships).toHaveLength(0);
      });

      it('rejects many-to-one with symbolic suggestion', () => {
        const result = parseERDiagram('posts\n  id: int [pk]\n\nusers\n  id: int [pk]\n\nposts many-to-one users');
        expect(result.error).toBeTruthy();
        expect(result.diagnostics[0].message).toContain('*--1');
      });

      it('rejects one-to-one with symbolic suggestion', () => {
        const result = parseERDiagram('users\n  id: int [pk]\n\nprofiles\n  id: int [pk]\n\nusers one-to-one profiles');
        expect(result.error).toBeTruthy();
        expect(result.diagnostics[0].message).toContain('1--1');
      });
    });

    describe('natural cardinality (rejected)', () => {
      it('rejects one to many with symbolic suggestion', () => {
        const result = parseERDiagram('users\n  id: int [pk]\n\nposts\n  id: int [pk]\n\nusers one to many posts');
        expect(result.error).toBeTruthy();
        expect(result.diagnostics[0].message).toContain('1--*');
      });
    });

    describe('relationship labels', () => {
      it('parses symbolic with label', () => {
        const result = parseERDiagram('users\n  id: int [pk]\n\nposts\n  id: int [pk]\n\nusers 1--* posts: writes');
        expect(result.relationships[0].label).toBe('writes');
      });
    });

    describe('self-referencing relationships', () => {
      it('allows relationship to same table', () => {
        const result = parseERDiagram('employees\n  id: int [pk]\n  manager_id: int [fk]\n\nemployees 1--* employees: manages');
        expect(result.relationships).toHaveLength(1);
        expect(result.relationships[0].source).toBe('employees');
        expect(result.relationships[0].target).toBe('employees');
      });
    });

    describe('auto-creates tables from relationships', () => {
      it('creates tables referenced in relationships', () => {
        const result = parseERDiagram('users 1--* posts');
        expect(result.tables).toHaveLength(2);
      });
    });

    it('tracks relationship line numbers', () => {
      const result = parseERDiagram('users\n  id: int [pk]\n\nposts\n  id: int [pk]\n\nusers 1--* posts');
      expect(result.relationships[0].lineNumber).toBe(7);
    });
  });

  // === Edge cases ===
  describe('edge cases', () => {
    it('handles multiple tables', () => {
      const result = parseERDiagram('users\n  id: int [pk]\n\nposts\n  id: int [pk]\n\ncomments\n  id: int [pk]');
      expect(result.tables).toHaveLength(3);
    });

    it('returns error for empty input', () => {
      const result = parseERDiagram('');
      expect(result.error).toBeDefined();
      // diagnostics
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe('error');
      expect(result.diagnostics[0].line).toBeGreaterThanOrEqual(0);
    });

    it('column with no type', () => {
      const result = parseERDiagram('users\n  active');
      expect(result.tables[0].columns[0].name).toBe('active');
      expect(result.tables[0].columns[0].type).toBeUndefined();
    });
  });
});

describe('looksLikeERDiagram', () => {
  it('detects tables with [pk] constraints', () => {
    expect(looksLikeERDiagram('users\n  id: int [pk]\n  name: varchar')).toBe(true);
  });

  it('detects tables with [fk] constraints', () => {
    expect(looksLikeERDiagram('posts\n  author_id: int [fk]')).toBe(true);
  });

  it('does not false-positive on plain text', () => {
    expect(looksLikeERDiagram('Hello World\nThis is just text')).toBe(false);
  });

  it('does not false-positive on class diagrams', () => {
    expect(looksLikeERDiagram('Animal [abstract]\n  name: string')).toBe(false);
  });

  it('does not false-positive on flowcharts', () => {
    expect(looksLikeERDiagram('(Start) -> [Process] -> (End)')).toBe(false);
  });

  it('does not false-positive on sequence diagrams', () => {
    expect(looksLikeERDiagram('Alice -> Bob: Hello\nBob -> Alice: Hi')).toBe(false);
  });
});
