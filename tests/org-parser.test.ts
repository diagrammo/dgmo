import { describe, it, expect } from 'vitest';
import { parseOrg } from '../src/org/parser';

describe('parseOrg', () => {
  // === Chart type ===
  describe('chart type', () => {
    it('accepts chart: org', () => {
      const result = parseOrg('chart: org\nJane Smith');
      expect(result.error).toBeNull();
      expect(result.roots).toHaveLength(1);
    });

    it('rejects wrong chart type', () => {
      const result = parseOrg('chart: flowchart\nJane Smith');
      expect(result.error).toMatch(/Expected chart type "org"/);
    });

    it('works without explicit chart: header', () => {
      const result = parseOrg('Jane Smith');
      expect(result.error).toBeNull();
      expect(result.roots).toHaveLength(1);
    });
  });

  // === Title ===
  describe('title', () => {
    it('parses title', () => {
      const result = parseOrg('chart: org\ntitle: Acme Corp\nJane Smith');
      expect(result.title).toBe('Acme Corp');
      expect(result.titleLineNumber).toBe(2);
    });

    it('no title returns null', () => {
      const result = parseOrg('chart: org\nJane Smith');
      expect(result.title).toBeNull();
      expect(result.titleLineNumber).toBeNull();
    });
  });

  // === Comments ===
  describe('comments', () => {
    it('ignores // comments', () => {
      const result = parseOrg('// this is a comment\nJane Smith');
      expect(result.error).toBeNull();
      expect(result.roots).toHaveLength(1);
    });

    it('ignores inline comments between nodes', () => {
      const result = parseOrg('Jane Smith\n// a comment\n  Alex Chen');
      expect(result.roots).toHaveLength(1);
      expect(result.roots[0].children).toHaveLength(1);
    });
  });

  // === Basic hierarchy ===
  describe('hierarchy', () => {
    it('single root node', () => {
      const result = parseOrg('Jane Smith');
      expect(result.roots).toHaveLength(1);
      expect(result.roots[0].label).toBe('Jane Smith');
      expect(result.roots[0].id).toBe('node-1');
      expect(result.roots[0].parentId).toBeNull();
      expect(result.roots[0].isContainer).toBe(false);
    });

    it('parent-child via indentation', () => {
      const result = parseOrg('Jane Smith\n  Alex Chen');
      expect(result.roots).toHaveLength(1);
      const jane = result.roots[0];
      expect(jane.children).toHaveLength(1);
      expect(jane.children[0].label).toBe('Alex Chen');
      expect(jane.children[0].parentId).toBe(jane.id);
    });

    it('deep hierarchy (3 levels)', () => {
      const result = parseOrg('Jane\n  Alex\n    Bob');
      const jane = result.roots[0];
      expect(jane.children).toHaveLength(1);
      const alex = jane.children[0];
      expect(alex.children).toHaveLength(1);
      expect(alex.children[0].label).toBe('Bob');
      expect(alex.children[0].parentId).toBe(alex.id);
    });

    it('siblings at same indent', () => {
      const result = parseOrg('Jane\n  Alex\n  Maria');
      const jane = result.roots[0];
      expect(jane.children).toHaveLength(2);
      expect(jane.children[0].label).toBe('Alex');
      expect(jane.children[1].label).toBe('Maria');
    });

    it('back-tracking indent creates correct hierarchy', () => {
      const result = parseOrg('Jane\n  Alex\n    Bob\n  Maria');
      const jane = result.roots[0];
      expect(jane.children).toHaveLength(2);
      expect(jane.children[0].label).toBe('Alex');
      expect(jane.children[0].children[0].label).toBe('Bob');
      expect(jane.children[1].label).toBe('Maria');
      expect(jane.children[1].parentId).toBe(jane.id);
    });

    it('multiple roots', () => {
      const result = parseOrg('Jane Smith\nJohn Doe');
      expect(result.roots).toHaveLength(2);
      expect(result.roots[0].label).toBe('Jane Smith');
      expect(result.roots[1].label).toBe('John Doe');
    });
  });

  // === Metadata ===
  describe('metadata', () => {
    it('parses key: value metadata', () => {
      const result = parseOrg('Jane Smith\n  role: CEO\n  location: NY');
      const jane = result.roots[0];
      expect(jane.metadata).toEqual({ role: 'CEO', location: 'NY' });
    });

    it('lowercases metadata keys', () => {
      const result = parseOrg('Jane Smith\n  Role: CEO\n  LOCATION: NY');
      const jane = result.roots[0];
      expect(jane.metadata).toEqual({ role: 'CEO', location: 'NY' });
    });

    it('preserves metadata value casing', () => {
      const result = parseOrg('Jane Smith\n  role: Chief Executive Officer');
      const jane = result.roots[0];
      expect(jane.metadata['role']).toBe('Chief Executive Officer');
    });

    it('metadata attaches to correct parent when mixed with children', () => {
      const result = parseOrg('Jane\n  role: CEO\n  Alex\n    role: CTO');
      const jane = result.roots[0];
      expect(jane.metadata).toEqual({ role: 'CEO' });
      expect(jane.children).toHaveLength(1);
      expect(jane.children[0].label).toBe('Alex');
      expect(jane.children[0].metadata).toEqual({ role: 'CTO' });
    });

    it('metadata on deeply nested node', () => {
      const result = parseOrg('Jane\n  Alex\n    Bob\n      role: Engineer');
      const bob = result.roots[0].children[0].children[0];
      expect(bob.metadata).toEqual({ role: 'Engineer' });
    });
  });

  // === Single-line compact metadata ===
  describe('single-line compact metadata', () => {
    it('parses pipe-delimited metadata', () => {
      const result = parseOrg('Alice Park | role: Senior | location: NY');
      const alice = result.roots[0];
      expect(alice.label).toBe('Alice Park');
      expect(alice.metadata).toEqual({ role: 'Senior', location: 'NY' });
    });

    it('single-line metadata with color', () => {
      const result = parseOrg('Alice Park(blue) | role: Senior');
      const alice = result.roots[0];
      expect(alice.label).toBe('Alice Park');
      expect(alice.color).toBeDefined();
      expect(alice.metadata).toEqual({ role: 'Senior' });
    });

    it('pipe segments without colon are ignored', () => {
      const result = parseOrg('Alice Park | Senior Engineer');
      const alice = result.roots[0];
      expect(alice.label).toBe('Alice Park');
      expect(alice.metadata).toEqual({});
    });
  });

  // === Containers ===
  describe('containers', () => {
    it('parses [Team] as container', () => {
      const result = parseOrg('Jane\n  [Platform Team]');
      const team = result.roots[0].children[0];
      expect(team.isContainer).toBe(true);
      expect(team.label).toBe('Platform Team');
      expect(team.id).toMatch(/^container-/);
    });

    it('container with children', () => {
      const result = parseOrg('[Engineering]\n  Alice\n  Bob');
      expect(result.roots).toHaveLength(1);
      const eng = result.roots[0];
      expect(eng.isContainer).toBe(true);
      expect(eng.children).toHaveLength(2);
    });

    it('container with metadata', () => {
      const result = parseOrg('[Platform Team]\n  goal: Core infrastructure');
      const team = result.roots[0];
      expect(team.isContainer).toBe(true);
      expect(team.metadata).toEqual({ goal: 'Core infrastructure' });
    });

    it('container with metadata and children', () => {
      const result = parseOrg(
        '[Platform Team]\n  goal: Core infra\n  Alice\n    role: Engineer'
      );
      const team = result.roots[0];
      expect(team.metadata).toEqual({ goal: 'Core infra' });
      expect(team.children).toHaveLength(1);
      expect(team.children[0].label).toBe('Alice');
      expect(team.children[0].metadata).toEqual({ role: 'Engineer' });
    });

    it('container with pipe-delimited children', () => {
      const result = parseOrg(
        '[Platform Team]\n  goal: Core infra\n  Alice Park | role: Senior Engineer | location: NY\n  Bob Torres | role: Junior Engineer | location: CO'
      );
      const team = result.roots[0];
      expect(team.metadata).toEqual({ goal: 'Core infra' });
      expect(team.children).toHaveLength(2);
      expect(team.children[0].label).toBe('Alice Park');
      expect(team.children[0].metadata).toEqual({ role: 'Senior Engineer', location: 'NY' });
      expect(team.children[1].label).toBe('Bob Torres');
      expect(team.children[1].metadata).toEqual({ role: 'Junior Engineer', location: 'CO' });
    });

    it('nested containers', () => {
      const result = parseOrg(
        '[Engineering]\n  [Platform]\n    Alice\n  [Frontend]\n    Bob'
      );
      const eng = result.roots[0];
      expect(eng.isContainer).toBe(true);
      expect(eng.children).toHaveLength(2);
      expect(eng.children[0].isContainer).toBe(true);
      expect(eng.children[0].label).toBe('Platform');
      expect(eng.children[0].children[0].label).toBe('Alice');
      expect(eng.children[1].isContainer).toBe(true);
      expect(eng.children[1].label).toBe('Frontend');
      expect(eng.children[1].children[0].label).toBe('Bob');
    });

    it('container with color suffix', () => {
      const result = parseOrg('[Platform Team(blue)]');
      const team = result.roots[0];
      expect(team.isContainer).toBe(true);
      expect(team.label).toBe('Platform Team');
      expect(team.color).toBeDefined();
    });
  });

  // === Tag groups ===
  describe('tag groups', () => {
    it('parses ## tag group with entries', () => {
      const result = parseOrg(
        '## Location\n  NY(blue)\n  LA(yellow)\n\nJane Smith'
      );
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Location');
      expect(result.tagGroups[0].entries).toHaveLength(2);
      expect(result.tagGroups[0].entries[0].value).toBe('NY');
      expect(result.tagGroups[0].entries[0].color).toBeDefined();
      expect(result.tagGroups[0].entries[1].value).toBe('LA');
    });

    it('multiple tag groups', () => {
      const result = parseOrg(
        '## Location\n  NY(blue)\n\n## Status\n  FTE(green)\n  Contractor(orange)\n\nJane'
      );
      expect(result.tagGroups).toHaveLength(2);
      expect(result.tagGroups[0].name).toBe('Location');
      expect(result.tagGroups[1].name).toBe('Status');
      expect(result.tagGroups[1].entries).toHaveLength(2);
    });

    it('tag group entry stores line number', () => {
      const result = parseOrg('## Location\n  NY(blue)\n\nJane');
      expect(result.tagGroups[0].lineNumber).toBe(1);
      expect(result.tagGroups[0].entries[0].lineNumber).toBe(2);
    });

    it('error on tag group after content', () => {
      const result = parseOrg('Jane Smith\n## Location\n  NY(blue)');
      expect(result.error).toMatch(/Tag groups .* must appear before org content/);
    });

    it('error on tag entry without color', () => {
      const result = parseOrg('## Location\n  NY\n\nJane');
      expect(result.error).toMatch(/Expected 'Value\(color\)' in tag group/);
    });
  });

  // === Colors ===
  describe('colors', () => {
    it('extracts color from node label', () => {
      const result = parseOrg('Jane Smith(blue)');
      const jane = result.roots[0];
      expect(jane.label).toBe('Jane Smith');
      expect(jane.color).toBeDefined();
    });

    it('no color when no suffix', () => {
      const result = parseOrg('Jane Smith');
      expect(result.roots[0].color).toBeUndefined();
    });
  });

  // === Line numbers ===
  describe('line numbers', () => {
    it('tracks line numbers on nodes', () => {
      const result = parseOrg('chart: org\ntitle: Test\n\nJane\n  Alex');
      expect(result.roots[0].lineNumber).toBe(4);
      expect(result.roots[0].children[0].lineNumber).toBe(5);
    });
  });

  // === Error handling ===
  describe('error handling', () => {
    it('returns error for empty content', () => {
      const result = parseOrg('');
      expect(result.error).toBe('No content provided');
    });

    it('returns error for whitespace-only content', () => {
      const result = parseOrg('   \n  \n  ');
      expect(result.error).toBe('No content provided');
    });

    it('returns error for no nodes', () => {
      const result = parseOrg('chart: org\ntitle: Empty');
      expect(result.error).toBe('No nodes found in org chart');
    });

    it('returns error for orphan metadata', () => {
      const result = parseOrg('chart: org\n  role: CEO');
      expect(result.error).toMatch(/Metadata has no parent node/);
    });
  });

  // === Edge cases ===
  describe('edge cases', () => {
    it('single node with no children', () => {
      const result = parseOrg('chart: org\nJane Smith');
      expect(result.roots).toHaveLength(1);
      expect(result.roots[0].children).toHaveLength(0);
    });

    it('container with no children', () => {
      const result = parseOrg('[Empty Team]');
      expect(result.roots).toHaveLength(1);
      expect(result.roots[0].isContainer).toBe(true);
      expect(result.roots[0].children).toHaveLength(0);
    });

    it('tab indentation counts as 4 spaces', () => {
      const result = parseOrg('Jane\n\tAlex');
      expect(result.roots[0].children).toHaveLength(1);
      expect(result.roots[0].children[0].label).toBe('Alex');
    });

    it('metadata value with colons', () => {
      const result = parseOrg('Jane\n  schedule: 9:00-5:00');
      expect(result.roots[0].metadata['schedule']).toBe('9:00-5:00');
    });

    it('node label that looks like metadata at root level is treated as node', () => {
      // "Dr. Smith: Surgeon" at indent 0 with no parent could be a name with colon
      const result = parseOrg('Dr. Smith: Surgeon');
      expect(result.roots).toHaveLength(1);
      expect(result.roots[0].label).toBe('Dr. Smith: Surgeon');
    });
  });

  // === Comprehensive example ===
  describe('comprehensive example', () => {
    it('parses full org chart DSL', () => {
      const content = `chart: org
title: Acme Corp

## Location
  NY(blue)
  LA(yellow)
  CO(green)

## Status
  FTE(green)
  Contractor(orange)

Jane Smith
  role: CEO
  location: NY
  status: FTE

  Alex Chen
    role: CTO
    location: LA

    [Platform Team]
      goal: Core infrastructure and APIs

      Alice Park
        role: Senior Engineer
        location: NY
      Bob Torres
        role: Junior Engineer
        location: CO

    [Frontend Team]
      goal: Ship new design system by Q3

      Carol Wu
        role: Senior Engineer
      Dave Kim
        role: Junior Engineer

  Maria Lopez
    role: Head of Design
    location: LA`;

      const result = parseOrg(content);
      expect(result.error).toBeNull();
      expect(result.title).toBe('Acme Corp');

      // Tag groups
      expect(result.tagGroups).toHaveLength(2);
      expect(result.tagGroups[0].name).toBe('Location');
      expect(result.tagGroups[0].entries).toHaveLength(3);
      expect(result.tagGroups[1].name).toBe('Status');
      expect(result.tagGroups[1].entries).toHaveLength(2);

      // Hierarchy
      expect(result.roots).toHaveLength(1);
      const jane = result.roots[0];
      expect(jane.label).toBe('Jane Smith');
      expect(jane.metadata).toEqual({
        role: 'CEO',
        location: 'NY',
        status: 'FTE',
      });

      // Jane's children: Alex, Maria
      expect(jane.children).toHaveLength(2);
      const alex = jane.children[0];
      expect(alex.label).toBe('Alex Chen');
      expect(alex.metadata).toEqual({ role: 'CTO', location: 'LA' });

      // Alex's children: Platform Team, Frontend Team
      expect(alex.children).toHaveLength(2);
      const platform = alex.children[0];
      expect(platform.isContainer).toBe(true);
      expect(platform.label).toBe('Platform Team');
      expect(platform.metadata).toEqual({
        goal: 'Core infrastructure and APIs',
      });
      expect(platform.children).toHaveLength(2);
      expect(platform.children[0].label).toBe('Alice Park');
      expect(platform.children[1].label).toBe('Bob Torres');

      const frontend = alex.children[1];
      expect(frontend.isContainer).toBe(true);
      expect(frontend.label).toBe('Frontend Team');
      expect(frontend.children).toHaveLength(2);

      const maria = jane.children[1];
      expect(maria.label).toBe('Maria Lopez');
      expect(maria.metadata).toEqual({
        role: 'Head of Design',
        location: 'LA',
      });
    });
  });
});
