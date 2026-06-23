import { describe, it, expect } from 'vitest';
import { parseOrg, looksLikeOrg } from '../src/org/parser';

describe('parseOrg', () => {
  // === Chart type ===
  describe('chart type', () => {
    it('accepts org on first line', () => {
      const result = parseOrg('org\nJane Smith');
      expect(result.error).toBeNull();
      expect(result.diagnostics).toEqual([]);
      expect(result.roots).toHaveLength(1);
    });

    it('rejects wrong chart type', () => {
      const result = parseOrg('flowchart\nJane Smith');
      expect(result.error).toMatch(/Expected chart type "org"/);
      // diagnostics
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toMatch(
        /Expected chart type "org"/
      );
      expect(result.diagnostics[0].severity).toBe('error');
      expect(result.diagnostics[0].line).toBeGreaterThanOrEqual(0);
    });

    it('works without explicit chart header', () => {
      const result = parseOrg('Jane Smith');
      expect(result.error).toBeNull();
      expect(result.roots).toHaveLength(1);
    });
  });

  // === Title ===
  describe('title', () => {
    it('parses title from first line', () => {
      const result = parseOrg('org Acme Corp\nJane Smith');
      expect(result.title).toBe('Acme Corp');
      expect(result.titleLineNumber).toBe(1);
    });

    it('no title returns null', () => {
      const result = parseOrg('org\nJane Smith');
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
      const result = parseOrg('Alice Park  role: Senior, location: NY');
      const alice = result.roots[0];
      expect(alice.label).toBe('Alice Park');
      expect(alice.metadata).toEqual({ role: 'Senior', location: 'NY' });
    });

    it('parses comma-separated metadata within pipe segment', () => {
      const result = parseOrg('Alice Park  role: Senior, location: NY');
      const alice = result.roots[0];
      expect(alice.label).toBe('Alice Park');
      expect(alice.metadata).toEqual({ role: 'Senior', location: 'NY' });
    });

    it('(color) suffix is literal in label with metadata', () => {
      const result = parseOrg('Alice Park blue  role: Senior');
      const alice = result.roots[0];
      expect(alice.label).toBe('Alice Park blue');
      expect(alice.color).toBeUndefined();
      expect(alice.metadata).toEqual({ role: 'Senior' });
    });

    it('legacy `|` operator emits E_PIPE_OPERATOR_REMOVED', () => {
      const result = parseOrg('Alice Park | Senior Engineer');
      const diag = result.diagnostics.find(
        (d) => d.code === 'E_PIPE_OPERATOR_REMOVED'
      );
      expect(diag).toBeDefined();
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
        '[Platform Team]\n  goal: Core infra\n  Alice Park  role: Senior Engineer, location: NY\n  Bob Torres  role: Junior Engineer, location: CO'
      );
      const team = result.roots[0];
      expect(team.metadata).toEqual({ goal: 'Core infra' });
      expect(team.children).toHaveLength(2);
      expect(team.children[0].label).toBe('Alice Park');
      expect(team.children[0].metadata).toEqual({
        role: 'Senior Engineer',
        location: 'NY',
      });
      expect(team.children[1].label).toBe('Bob Torres');
      expect(team.children[1].metadata).toEqual({
        role: 'Junior Engineer',
        location: 'CO',
      });
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

    it('container (color) suffix is literal', () => {
      const result = parseOrg('[Platform Team blue]');
      const team = result.roots[0];
      expect(team.isContainer).toBe(true);
      expect(team.label).toBe('Platform Team blue');
      expect(team.color).toBeUndefined();
    });
  });

  // === Tag groups ===
  describe('tag groups', () => {
    it('parses tag group with entries', () => {
      const result = parseOrg(
        'tag Location\n  NY blue\n  LA yellow\n\nJane Smith'
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
        'tag Location\n  NY blue\n\ntag Status\n  FTE green\n  Contractor orange\n\nJane'
      );
      expect(result.tagGroups).toHaveLength(2);
      expect(result.tagGroups[0].name).toBe('Location');
      expect(result.tagGroups[1].name).toBe('Status');
      expect(result.tagGroups[1].entries).toHaveLength(2);
    });

    it('tag group entry stores line number', () => {
      const result = parseOrg('tag Location\n  NY blue\n\nJane');
      expect(result.tagGroups[0].lineNumber).toBe(1);
      expect(result.tagGroups[0].entries[0].lineNumber).toBe(2);
    });

    it('error on tag group after content', () => {
      const result = parseOrg('Jane Smith\ntag Location\n  NY blue');
      expect(result.error).toMatch(/Tag groups must appear before org content/);
    });

    it('auto-assigns a palette color to a bare tag value (no error, not dropped)', () => {
      const result = parseOrg('tag Location\n  NY\n\nJane');
      expect(result.error).toBeNull();
      expect(result.tagGroups[0].entries).toHaveLength(1);
      const entry = result.tagGroups[0].entries[0];
      expect(entry.value).toBe('NY');
      // Auto color is a resolved hex, not empty and not the grey fallback.
      expect(entry.color).toMatch(/^#/);
      expect(entry.color).not.toBe('');
      expect(entry.color).not.toBe('#999999');
      expect(
        result.diagnostics.some((d) =>
          d.message.includes("Expected 'Value color'")
        )
      ).toBe(false);
    });

    it('first entry is default', () => {
      const result = parseOrg('tag Location\n  CO green\n  NY blue\n\nJane');
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].defaultValue).toBe('CO');
      expect(result.tagGroups[0].entries).toHaveLength(2);
      expect(result.tagGroups[0].entries[0].value).toBe('CO');
    });

    it('single-entry tag group has that entry as default', () => {
      const result = parseOrg('tag Location\n  NY blue\n\nJane');
      expect(result.tagGroups[0].defaultValue).toBe('NY');
    });

    it('bare value skips a color used by an explicit entry BELOW it', () => {
      // High is bare; Low explicitly red below it. High must not get red.
      const result = parseOrg(
        'tag Priority\n  High\n  Low red\n\nAlice priority: High'
      );
      expect(result.error).toBeNull();
      const entries = result.tagGroups[0].entries;
      const high = entries.find((e) => e.value === 'High')!;
      const low = entries.find((e) => e.value === 'Low')!;
      expect(low.color).toBe('#bf616a'); // explicit red (Nord)
      expect(high.color).not.toBe('#bf616a');
      expect(high.color).toMatch(/^#/);
    });

    it('explicit color still wins over auto-assignment', () => {
      const result = parseOrg('tag Priority\n  High blue\n  Low\n\nAlice');
      const high = result.tagGroups[0].entries.find((e) => e.value === 'High')!;
      expect(high.color).toBe('#5e81ac'); // explicit blue (Nord)
    });
  });

  // === Tag group aliases ===
  describe('tag group aliases', () => {
    it('parses from tag group heading', () => {
      const result = parseOrg('tag Location as loc\n  NY blue\n\nJane Smith');
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Location');
      expect(result.tagGroups[0].alias).toBe('loc');
      expect(result.tagGroups[0].entries).toHaveLength(1);
    });

    it('tag group without alias still works', () => {
      const result = parseOrg('tag Location\n  NY blue\n\nJane Smith');
      expect(result.tagGroups[0].name).toBe('Location');
      expect(result.tagGroups[0].alias).toBeUndefined();
    });

    it('expands in pipe-delimited metadata', () => {
      const result = parseOrg(
        'tag Title as t\n  CTO purple\n\nSean Curtis t: CTO'
      );
      const sean = result.roots[0];
      expect(sean.metadata).toEqual({ title: 'CTO' });
    });

    it('expands in comma-separated metadata', () => {
      const result = parseOrg(
        'tag Title as t\n  CTO purple\n\ntag Location as loc\n  NY blue\n\nSean Curtis t: CTO, loc: NY'
      );
      const sean = result.roots[0];
      expect(sean.metadata).toEqual({ title: 'CTO', location: 'NY' });
    });

    it('expands in standalone metadata lines', () => {
      const result = parseOrg(
        'tag Location as loc\n  NY blue\n\nSean Curtis\n  loc: NY'
      );
      const sean = result.roots[0];
      expect(sean.metadata).toEqual({ location: 'NY' });
    });

    it('multiple aliases with comma separators in single pipe', () => {
      const result = parseOrg(
        'tag Location as loc\n  NY blue\n  CA green\n\ntag Status as st\n  FTE green\n\ntag Title as t\n  CTO purple\n\nSean Curtis  t: CTO, loc: NY, st: FTE'
      );
      expect(result.tagGroups).toHaveLength(3);
      const sean = result.roots[0];
      expect(sean.metadata).toEqual({
        title: 'CTO',
        location: 'NY',
        status: 'FTE',
      });
    });

    it('multiple aliases with comma separators', () => {
      const result = parseOrg(
        'tag Location as loc\n  NY blue\n  CA green\n\ntag Status as st\n  FTE green\n\ntag Title as t\n  CTO purple\n\nSean Curtis t: CTO, loc: NY, st: FTE'
      );
      expect(result.tagGroups).toHaveLength(3);
      const sean = result.roots[0];
      expect(sean.metadata).toEqual({
        title: 'CTO',
        location: 'NY',
        status: 'FTE',
      });
    });

    it('alias on tag group heading', () => {
      const result = parseOrg('tag Status as st\n  FTE green\n\nJane');
      expect(result.tagGroups[0].name).toBe('Status');
      expect(result.tagGroups[0].alias).toBe('st');
    });

    it('non-aliased keys pass through unchanged', () => {
      const result = parseOrg(
        'tag Title as t\n  CTO purple\n\nSean Curtis  t: CTO, role: VP'
      );
      const sean = result.roots[0];
      expect(sean.metadata).toEqual({ title: 'CTO', role: 'VP' });
    });
  });

  // === tag block syntax ===
  describe('tag block syntax', () => {
    it('parses tag heading with entries', () => {
      const result = parseOrg(
        'tag Location\n  NY blue\n  LA yellow\n\nJane Smith'
      );
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Location');
      expect(result.tagGroups[0].entries).toHaveLength(2);
      expect(result.tagGroups[0].entries[0].value).toBe('NY');
    });

    it('parses tag with alias', () => {
      const result = parseOrg('tag Location as loc\n  NY blue\n\nJane Smith');
      expect(result.tagGroups[0].name).toBe('Location');
      expect(result.tagGroups[0].alias).toBe('loc');
    });

    it('first entry is default', () => {
      const result = parseOrg('tag Location\n  CO green\n  NY blue\n\nJane');
      expect(result.tagGroups[0].defaultValue).toBe('CO');
    });

    it('is case-insensitive (Tag, TAG)', () => {
      const r1 = parseOrg('Tag Location\n  NY blue\n\nJane');
      expect(r1.tagGroups[0].name).toBe('Location');

      const r2 = parseOrg('TAG Location\n  NY blue\n\nJane');
      expect(r2.tagGroups[0].name).toBe('Location');
    });

    it('does not emit deprecation warning for tag syntax', () => {
      const result = parseOrg('tag Location\n  NY blue\n\nJane');
      const warnings = result.diagnostics.filter(
        (d) => d.severity === 'warning'
      );
      expect(warnings).toHaveLength(0);
    });

    it('ignores ## syntax (no longer recognized as tag heading)', () => {
      const result = parseOrg('## Location\n  NY blue\n\nJane');
      expect(result.tagGroups).toHaveLength(0);
    });

    it('tag Rank is not swallowed as option key', () => {
      const result = parseOrg('tag Rank\n  Captain red\n\nJane');
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Rank');
      expect(result.options['tag']).toBeUndefined();
    });

    it('expands in metadata with tag syntax', () => {
      const result = parseOrg('tag Title as t\n  CTO purple\n\nSean t: CTO');
      expect(result.roots[0].metadata).toEqual({ title: 'CTO' });
    });

    it('looksLikeOrg recognizes tag syntax', () => {
      expect(looksLikeOrg('tag Rank\n  Captain red\n\nJane')).toBe(true);
      expect(looksLikeOrg('Tag Rank\n  Captain red\n\nJane')).toBe(true);
      // ## is no longer recognized
      expect(looksLikeOrg('## Rank\n  Captain red\n\nJane')).toBe(false);
      // Non-tag content
      expect(looksLikeOrg('org\nJane')).toBe(false);
    });
  });

  // === Header options ===
  describe('header options', () => {
    it('defaults to empty options', () => {
      const result = parseOrg('org\nJane Smith');
      expect(result.options).toEqual({});
    });

    it('works alongside title and tag groups', () => {
      const result = parseOrg('org Acme\n\ntag Location\n  NY blue\n\nJane');
      expect(result.title).toBe('Acme');
      expect(result.options).toEqual({});
      expect(result.tagGroups).toHaveLength(1);
      expect(result.roots).toHaveLength(1);
    });

    it('parses direction-tb boolean option', () => {
      const result = parseOrg('org\ndirection-tb\n\nJane');
      expect(result.options).toEqual({ 'direction-tb': 'on' });
    });

    it('parses hide option with comma-separated keys', () => {
      const result = parseOrg('org\nhide location, status\n\nJane');
      expect(result.options).toEqual({ hide: 'location, status' });
    });

    it('parses bare boolean option', () => {
      const result = parseOrg('org\nshow-sub-node-count\n\nJane');
      expect(result.options['show-sub-node-count']).toBe('on');
    });
  });

  // === Colors ===
  describe('colors', () => {
    it('(color) suffix is literal in node label', () => {
      const result = parseOrg('Jane Smith blue');
      const jane = result.roots[0];
      expect(jane.label).toBe('Jane Smith blue');
      expect(jane.color).toBeUndefined();
    });

    it('no color when no suffix', () => {
      const result = parseOrg('Jane Smith');
      expect(result.roots[0].color).toBeUndefined();
    });
  });

  // === Line numbers ===
  describe('line numbers', () => {
    it('tracks line numbers on nodes', () => {
      const result = parseOrg('org Test\n\nJane\n  Alex');
      expect(result.roots[0].lineNumber).toBe(3);
      expect(result.roots[0].children[0].lineNumber).toBe(4);
    });
  });

  // === Error handling ===
  describe('error handling', () => {
    it('returns error for empty content', () => {
      const result = parseOrg('');
      expect(result.error).toBe('No content provided');
      // diagnostics
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toBe('No content provided');
      expect(result.diagnostics[0].severity).toBe('error');
      expect(result.diagnostics[0].line).toBeGreaterThanOrEqual(0);
    });

    it('returns error for whitespace-only content', () => {
      const result = parseOrg('   \n  \n  ');
      expect(result.error).toBe('No content provided');
      // diagnostics
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe('error');
    });

    it('returns error for no nodes', () => {
      const result = parseOrg('org Empty');
      expect(result.error).toBe('Line 1: No nodes found in org chart');
    });

    it('returns error for orphan metadata', () => {
      const result = parseOrg('org\n  role: CEO');
      expect(result.error).toMatch(/must be indented under a node/);
    });
  });

  // === Edge cases ===
  describe('edge cases', () => {
    it('single node with no children', () => {
      const result = parseOrg('org\nJane Smith');
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
      const content = `org Acme Corp

tag Location
  NY blue
  LA yellow
  CO green

tag Status
  FTE green
  Contractor orange

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

  // === Tag-group-only files ===
  describe('tag-group-only files', () => {
    it('parses tag-group-only input with no error', () => {
      const result = parseOrg(
        'tag Rank as r\n  Captain red\n  Sailor blue\n\ntag Status\n  Active green\n  Inactive gray'
      );
      expect(result.error).toBeNull();
      expect(result.roots).toHaveLength(0);
      expect(result.tagGroups).toHaveLength(2);
    });

    it('preserves and default in tag-group-only input', () => {
      const result = parseOrg('tag Rank as r\n  Sailor blue\n  Captain red');
      expect(result.tagGroups[0].name).toBe('Rank');
      expect(result.tagGroups[0].alias).toBe('r');
      expect(result.tagGroups[0].defaultValue).toBe('Sailor');
    });
  });

  // === Tag value validation ===
  describe('tag value validation', () => {
    it('warns on undefined tag group value', () => {
      const input = `tag Department
  Engineering blue
  Design green

Alice  department: Marketing`;
      const result = parseOrg(input);
      expect(result.error).toBeNull();
      const warnings = result.diagnostics.filter(
        (d) => d.severity === 'warning'
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain("Unknown value 'Marketing'");
      expect(warnings[0].message).toContain('Department');
      expect(warnings[0].line).toBe(5);
    });

    it('does not warn on valid tag group value', () => {
      const input = `tag Department
  Engineering blue
  Design green

Alice  department: Engineering`;
      const result = parseOrg(input);
      const warnings = result.diagnostics.filter(
        (d) => d.severity === 'warning'
      );
      expect(warnings).toHaveLength(0);
    });

    it('matches tag values case-insensitively', () => {
      const input = `tag Department
  Engineering blue

Alice  department: engineering`;
      const result = parseOrg(input);
      const warnings = result.diagnostics.filter(
        (d) => d.severity === 'warning'
      );
      expect(warnings).toHaveLength(0);
    });

    it('suggests similar value with did-you-mean', () => {
      const input = `tag Department
  Engineering blue
  Design green

Alice  department: Enginering`;
      const result = parseOrg(input);
      const warnings = result.diagnostics.filter(
        (d) => d.severity === 'warning'
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('Did you mean');
    });

    it('lists defined values when no close match', () => {
      const input = `tag Department
  Engineering blue
  Design green

Alice  department: Finance`;
      const result = parseOrg(input);
      const warnings = result.diagnostics.filter(
        (d) => d.severity === 'warning'
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('Engineering, Design');
    });

    it('validates values on nested nodes', () => {
      const input = `tag Role
  Manager red
  IC blue

CEO
  Alice  role: VP`;
      const result = parseOrg(input);
      const warnings = result.diagnostics.filter(
        (d) => d.severity === 'warning'
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain("Unknown value 'VP'");
    });

    it('validates values assigned via alias', () => {
      const input = `tag Department as d
  Engineering blue

Alice  d: Marketing`;
      const result = parseOrg(input);
      const warnings = result.diagnostics.filter(
        (d) => d.severity === 'warning'
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain("Unknown value 'Marketing'");
      expect(warnings[0].message).toContain('Department');
    });
  });
});
