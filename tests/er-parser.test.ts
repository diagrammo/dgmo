import { describe, it, expect } from 'vitest';
import { parseERDiagram, looksLikeERDiagram } from '../src/er/parser';

describe('parseERDiagram', () => {
  // === Metadata ===
  describe('metadata', () => {
    it('parses er on first line', () => {
      const result = parseERDiagram('er\nusers\n  id int pk');
      expect(result.type).toBe('er');
      expect(result.error).toBeNull();
      expect(result.diagnostics).toEqual([]);
    });

    it('parses er with title on first line', () => {
      const result = parseERDiagram('er Blog Platform\nusers\n  id int pk');
      expect(result.type).toBe('er');
      expect(result.title).toBe('Blog Platform');
      expect(result.error).toBeNull();
    });

    it('parses notation option (no colon)', () => {
      const result = parseERDiagram('er\nnotation labels\nusers\n  id int pk');
      expect(result.options.notation).toBe('labels');
    });
  });

  // === Comments ===
  describe('comments', () => {
    it('ignores // comments', () => {
      const result = parseERDiagram('// this is a comment\nusers\n  id int pk');
      expect(result.error).toBeNull();
      expect(result.tables).toHaveLength(1);
    });
  });

  // === Table declarations ===
  describe('table declarations', () => {
    it('parses simple table', () => {
      const result = parseERDiagram('users\n  id int pk');
      expect(result.tables).toHaveLength(1);
      expect(result.tables[0].name).toBe('users');
      expect(result.tables[0].id).toBe('users');
    });

    it('parses table with color', () => {
      const result = parseERDiagram('users red\n  id int pk');
      expect(result.tables[0].color).toBeDefined();
    });

    it('parses table with underscore name', () => {
      const result = parseERDiagram('user_roles\n  id int pk');
      expect(result.tables[0].name).toBe('user_roles');
    });

    it('tracks line numbers', () => {
      const result = parseERDiagram('er Test\n\nusers\n  id int pk');
      expect(result.tables[0].lineNumber).toBe(3);
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
      const result = parseERDiagram('users\n  name varchar');
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
      const result = parseERDiagram('users\n  id int pk');
      const col = result.tables[0].columns[0];
      expect(col.constraints).toContain('pk');
    });

    it('parses column with fk constraint', () => {
      const result = parseERDiagram('posts\n  author_id int fk');
      const col = result.tables[0].columns[0];
      expect(col.constraints).toContain('fk');
    });

    it('parses column with unique constraint', () => {
      const result = parseERDiagram('users\n  email varchar unique');
      const col = result.tables[0].columns[0];
      expect(col.constraints).toContain('unique');
    });

    it('parses column with nullable constraint', () => {
      const result = parseERDiagram('users\n  bio text nullable');
      const col = result.tables[0].columns[0];
      expect(col.constraints).toContain('nullable');
    });

    it('parses column with multiple constraints', () => {
      const result = parseERDiagram('users\n  id int pk unique');
      const col = result.tables[0].columns[0];
      expect(col.constraints).toContain('pk');
      expect(col.constraints).toContain('unique');
    });

    it('tracks column line numbers', () => {
      const result = parseERDiagram('users\n  id int pk\n  name varchar');
      expect(result.tables[0].columns[0].lineNumber).toBe(2);
      expect(result.tables[0].columns[1].lineNumber).toBe(3);
    });

    it('parses multiple columns', () => {
      const result = parseERDiagram(
        'users\n  id int pk\n  name varchar\n  email varchar unique'
      );
      expect(result.tables[0].columns).toHaveLength(3);
    });
  });

  // === Top-level relationships (rejected) ===
  describe('top-level relationships (rejected)', () => {
    it('rejects top-level symbolic relationship with warning', () => {
      const result = parseERDiagram(
        'users\n  id int pk\n\nposts\n  id int pk\n\nusers 1--* posts'
      );
      expect(result.relationships).toHaveLength(0);
      expect(
        result.diagnostics.some((d) => d.message.includes('must be indented'))
      ).toBe(true);
    });

    it('rejects keyword cardinality with symbolic suggestion', () => {
      const result = parseERDiagram(
        'users\n  id int pk\n\nposts\n  id int pk\n\nusers one-to-many posts'
      );
      expect(result.error).toBeTruthy();
      expect(result.diagnostics[0].message).toContain('1--*');
      expect(result.relationships).toHaveLength(0);
    });

    it('rejects natural cardinality with symbolic suggestion', () => {
      const result = parseERDiagram(
        'users\n  id int pk\n\nposts\n  id int pk\n\nusers one to many posts'
      );
      expect(result.error).toBeTruthy();
      expect(result.diagnostics[0].message).toContain('1--*');
    });
  });

  // === Indented relationships ===
  describe('indented relationships', () => {
    it('parses basic indented 1-* relationship', () => {
      const result = parseERDiagram('users\n  id int pk\n  1-* posts');
      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].source).toBe('users');
      expect(result.relationships[0].target).toBe('posts');
      expect(result.relationships[0].cardinality.from).toBe('1');
      expect(result.relationships[0].cardinality.to).toBe('*');
      expect(result.relationships[0].label).toBeUndefined();
    });

    it('parses labeled indented relationship', () => {
      const result = parseERDiagram('users\n  1-writes-* posts');
      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].label).toBe('writes');
      expect(result.relationships[0].source).toBe('users');
      expect(result.relationships[0].target).toBe('posts');
    });

    it('mixes columns and indented relationships', () => {
      const result = parseERDiagram(
        'users\n  id int pk\n  name varchar\n  1-* posts\n  1-writes-* comments'
      );
      expect(result.tables[0].columns).toHaveLength(2);
      expect(result.relationships).toHaveLength(2);
      expect(result.relationships[0].target).toBe('posts');
      expect(result.relationships[1].target).toBe('comments');
      expect(result.relationships[1].label).toBe('writes');
    });

    it('handles all cardinality combos', () => {
      const combos = [
        ['1-* t1', '1', '*'],
        ['*-1 t2', '*', '1'],
        ['1-1 t3', '1', '1'],
        ['*-* t4', '*', '*'],
        ['?-1 t5', '?', '1'],
        ['1-? t6', '1', '?'],
      ] as const;
      const lines = [
        'src\n  id int pk',
        ...combos.map(([line]) => `  ${line}`),
      ].join('\n');
      const result = parseERDiagram(lines);
      expect(result.relationships).toHaveLength(6);
      combos.forEach(([, from, to], i) => {
        expect(result.relationships[i].cardinality.from).toBe(from);
        expect(result.relationships[i].cardinality.to).toBe(to);
      });
    });

    it('auto-creates target table', () => {
      const result = parseERDiagram('users\n  1-* posts');
      expect(result.tables).toHaveLength(2);
      expect(result.tables.find((t) => t.name === 'posts')).toBeDefined();
    });

    it('parses double-dash unlabeled indented relationship', () => {
      const result = parseERDiagram('ports\n  id int pk\n  1--* ships');
      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].source).toBe('ports');
      expect(result.relationships[0].target).toBe('ships');
      expect(result.relationships[0].cardinality.from).toBe('1');
      expect(result.relationships[0].cardinality.to).toBe('*');
      expect(result.relationships[0].label).toBeUndefined();
    });

    it('parses double-dash labeled indented relationship', () => {
      const result = parseERDiagram(
        'ships\n  id int pk\n  1--carries--* treasure'
      );
      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].label).toBe('carries');
      expect(result.relationships[0].cardinality.from).toBe('1');
      expect(result.relationships[0].cardinality.to).toBe('*');
    });

    it('supports self-referencing relationship', () => {
      const result = parseERDiagram(
        'employees\n  id int pk\n  1-manages-* employees'
      );
      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].source).toBe('employees');
      expect(result.relationships[0].target).toBe('employees');
      expect(result.relationships[0].label).toBe('manages');
    });

    it('tracks line numbers for indented relationships', () => {
      const result = parseERDiagram('users\n  id int pk\n  1-* posts');
      expect(result.relationships[0].lineNumber).toBe(3);
    });
  });

  // === Edge cases ===
  describe('edge cases', () => {
    it('handles multiple tables', () => {
      const result = parseERDiagram(
        'users\n  id int pk\n\nposts\n  id int pk\n\ncomments\n  id int pk'
      );
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
  it('detects tables with pk constraints', () => {
    expect(looksLikeERDiagram('users\n  id int pk\n  name varchar')).toBe(true);
  });

  it('detects tables with fk constraints', () => {
    expect(looksLikeERDiagram('posts\n  author_id int fk')).toBe(true);
  });

  it('detects indented relationships', () => {
    expect(looksLikeERDiagram('users\n  id int pk\n  1-* posts')).toBe(true);
  });

  it('detects indented relationships with table decl (no constraints)', () => {
    expect(
      looksLikeERDiagram('users\n  1-* posts\nposts\n  1-* comments')
    ).toBe(true);
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
    expect(looksLikeERDiagram('Alice -> Bob: Hello\nBob -> Alice: Hi')).toBe(
      false
    );
  });
});

// ============================================================
// Tag Groups
// ============================================================

describe('tag groups', () => {
  it('parses tag blocks with entries', () => {
    const result = parseERDiagram(`er

tag Domain as d
  Billing blue
  Shipping green

Users d: Billing
  id int pk`);
    expect(result.tagGroups).toHaveLength(1);
    expect(result.tagGroups[0].name).toBe('Domain');
    expect(result.tagGroups[0].alias).toBe('d');
    expect(result.tagGroups[0].entries).toHaveLength(2);
    expect(result.tagGroups[0].entries[0].value).toBe('Billing');
    expect(result.tagGroups[0].entries[1].value).toBe('Shipping');
  });

  it('parses same-line metadata on table declarations', () => {
    const result = parseERDiagram(`er

tag Domain as d
  Billing blue

Users d: Billing
  id int pk`);
    expect(result.tables[0].metadata).toEqual({ domain: 'Billing' });
  });

  it('resolves alias in same-line metadata', () => {
    const result = parseERDiagram(`er

tag Domain as d
  Billing blue

Orders d: Billing
  id int pk`);
    // Alias 'd' resolves to 'domain'
    expect(result.tables[0].metadata).toEqual({ domain: 'Billing' });
  });

  it('injects default tag values (first entry is default)', () => {
    const result = parseERDiagram(`er

tag Domain
  Core gray
  Billing blue

Users
  id int pk`);
    // Users has no explicit Domain tag, so it should get the default (first entry)
    expect(result.tables[0].metadata.domain).toBe('Core');
  });

  it('warns on unknown tag values', () => {
    const result = parseERDiagram(`er

tag Domain
  Billing blue
  Shipping green

Users Domain: Unknown
  id int pk`);
    const warnings = result.diagnostics.filter((d) =>
      d.message.includes("Unknown value 'Unknown'")
    );
    expect(warnings).toHaveLength(1);
  });

  it('preserves explicit table color alongside metadata', () => {
    const result = parseERDiagram(`er

tag Domain
  Billing blue

Users red Domain: Billing
  id int pk`);
    expect(result.tables[0].color).toBeDefined();
    expect(result.tables[0].metadata.domain).toBe('Billing');
  });

  it('existing ER without tags still works', () => {
    const result = parseERDiagram(`er
Users
  id int pk
  email varchar unique
  1-* Orders

Orders
  id int pk`);
    expect(result.error).toBeNull();
    expect(result.tagGroups).toHaveLength(0);
    expect(result.tables).toHaveLength(2);
  });

  it('ignores ## syntax (no longer recognized as tag heading)', () => {
    const result = parseERDiagram(`er

## Domain
  Billing blue

Users Domain: Billing
  id int pk`);
    expect(result.tagGroups).toHaveLength(0);
  });
});

describe('a column that does not parse is reported, never dropped', () => {
  // Regression for the silent-deletion bug: `fk, nullable` (comma) made
  // parseColumn return null and the caller discarded it, so the column
  // vanished from the diagram with no error and a zero exit code. Five columns
  // went missing from a real schema drawing that way, including both foreign
  // keys on one table, and the shipped ER example carried the same line.
  it('errors on comma-separated constraints instead of deleting the column', () => {
    const result = parseERDiagram(
      'er\nthings\n  id text pk\n  owner_id text fk, nullable'
    );
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('space-separated');
    // The whole line is refused, so the column is absent — but LOUDLY, which is
    // the entire point. Silence was the defect, not the absence.
    expect(result.tables[0]?.columns.map((c) => c.name)).toEqual(['id']);
  });

  it('keeps the column when the same constraints are space-separated', () => {
    const result = parseERDiagram(
      'er\nthings\n  id text pk\n  owner_id text fk nullable'
    );
    expect(result.error).toBeNull();
    expect(result.diagnostics).toEqual([]);
    const owner = result.tables[0]?.columns.find((c) => c.name === 'owner_id');
    expect(owner?.constraints).toEqual(['fk', 'nullable']);
  });

  it('names the offending token for any other unknown constraint', () => {
    const result = parseERDiagram('er\nthings\n  id text pk notnull');
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('notnull');
  });

  it('reports prose under a table by naming the token it choked on', () => {
    // `this` reads as the name and `is` as the type, so this lands on the
    // unknown-token path rather than the not-a-column one.
    const result = parseERDiagram('er\nthings\n  this is just prose');
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('just');
  });

  it('reports an indented line that cannot even start a column', () => {
    const result = parseERDiagram('er\nthings\n  (a parenthetical aside)');
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('relationship');
  });

  it('still accepts every valid column shape', () => {
    const result = parseERDiagram(
      'er\nthings\n  id text pk\n  name\n  email text unique\n  "first name" text nullable\n  1-has-* others'
    );
    expect(result.error).toBeNull();
    expect(result.tables[0]?.columns.map((c) => c.name)).toEqual([
      'id',
      'name',
      'email',
      'first name',
    ]);
  });
});
