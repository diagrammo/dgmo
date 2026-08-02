import { describe, it, expect } from 'vitest';
import { parseSitemap, looksLikeSitemap } from '../src/sitemap/parser';

describe('parseSitemap', () => {
  // === Chart type ===
  describe('chart type', () => {
    it('accepts sitemap first line', () => {
      const result = parseSitemap('sitemap\nHome');
      expect(result.error).toBeNull();
      expect(result.diagnostics).toEqual([]);
      expect(result.roots).toHaveLength(1);
    });

    it('rejects wrong chart type', () => {
      const result = parseSitemap('flowchart\nHome');
      expect(result.error).toMatch(/Expected chart type "sitemap"/);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe('error');
    });

    it('works without explicit chart header', () => {
      const result = parseSitemap('Home');
      expect(result.error).toBeNull();
      expect(result.roots).toHaveLength(1);
    });
  });

  // === Title ===
  describe('title', () => {
    it('parses title from first line', () => {
      const result = parseSitemap('sitemap My Website\nHome');
      expect(result.title).toBe('My Website');
      expect(result.titleLineNumber).toBe(1);
    });

    it('no title returns null', () => {
      const result = parseSitemap('sitemap\nHome');
      expect(result.title).toBeNull();
    });
  });

  // === Direction ===
  describe('direction', () => {
    it('defaults to TB', () => {
      const result = parseSitemap('Home');
      expect(result.direction).toBe('LR');
    });

    it('parses direction-tb', () => {
      const result = parseSitemap('sitemap\ndirection-tb\nHome');
      expect(result.direction).toBe('TB');
    });
  });

  // === Comments ===
  describe('comments', () => {
    it('ignores // comments', () => {
      const result = parseSitemap('// comment\nHome');
      expect(result.error).toBeNull();
      expect(result.roots).toHaveLength(1);
    });
  });

  // === Empty input ===
  describe('empty input', () => {
    it('returns error for empty string', () => {
      const result = parseSitemap('');
      expect(result.error).toMatch(/No content provided/);
    });

    it('returns error for whitespace-only', () => {
      const result = parseSitemap('   \n  ');
      expect(result.error).toMatch(/No content provided/);
    });

    it('returns error for no pages', () => {
      const result = parseSitemap('sitemap');
      expect(result.error).toMatch(/No pages found/);
    });
  });

  // === Hierarchy ===
  describe('hierarchy', () => {
    it('single root node', () => {
      const result = parseSitemap('Home');
      expect(result.roots).toHaveLength(1);
      expect(result.roots[0].label).toBe('Home');
      expect(result.roots[0].isContainer).toBe(false);
      expect(result.roots[0].parentId).toBeNull();
    });

    it('parent-child via indentation', () => {
      const result = parseSitemap('Home\n  About\n  Contact');
      expect(result.roots).toHaveLength(1);
      expect(result.roots[0].children).toHaveLength(2);
      expect(result.roots[0].children[0].label).toBe('About');
      expect(result.roots[0].children[1].label).toBe('Contact');
    });

    it('nested children', () => {
      const result = parseSitemap('Home\n  About\n    Team\n    History');
      const about = result.roots[0].children[0];
      expect(about.children).toHaveLength(2);
      expect(about.children[0].label).toBe('Team');
    });

    it('multiple roots', () => {
      const result = parseSitemap('Home\nBlog');
      expect(result.roots).toHaveLength(2);
    });
  });

  // === Containers ===
  describe('containers', () => {
    it('parses [Group Name] as container', () => {
      const result = parseSitemap('[Navigation]\n  Home\n  About');
      expect(result.roots).toHaveLength(1);
      expect(result.roots[0].isContainer).toBe(true);
      expect(result.roots[0].label).toBe('Navigation');
      expect(result.roots[0].children).toHaveLength(2);
    });

    it('nested containers', () => {
      const result = parseSitemap('[Main]\n  [Sub]\n    Page A');
      expect(result.roots[0].isContainer).toBe(true);
      expect(result.roots[0].children[0].isContainer).toBe(true);
      expect(result.roots[0].children[0].children[0].label).toBe('Page A');
    });
  });

  // === Quoted names (spec §2.2) ===
  describe('quoted names', () => {
    it('peels quotes from a page name', () => {
      const result = parseSitemap('sitemap T\n"Order | Items"');
      expect(result.error).toBeNull();
      expect(result.roots[0].label).toBe('Order | Items');
    });

    it('keeps a reserved character inside the name', () => {
      const result = parseSitemap(
        'sitemap T\n"Order | Items" as oi\n  Details'
      );
      expect(result.roots[0].label).toBe('Order | Items');
      expect(result.roots[0].label).toContain('|');
    });

    it('a quoted parent still adopts its indented children', () => {
      const result = parseSitemap(
        'sitemap T\n"Order | Items"\n  Details\n  Refunds'
      );
      expect(result.roots).toHaveLength(1);
      expect(result.roots[0].children.map((c) => c.label)).toEqual([
        'Details',
        'Refunds',
      ]);
    });

    it('quoted and bare references resolve to the same node', () => {
      const result = parseSitemap(
        'sitemap T\n"Order | Items"\nHome\n  -> "Order | Items"\n  -> Order | Items'
      );
      expect(result.error).toBeNull();
      expect(result.edges).toHaveLength(2);
      expect(result.edges[0].targetId).toBe(result.roots[0].id);
      expect(result.edges[1].targetId).toBe(result.roots[0].id);
    });

    it('peels quotes from a container name and its group-targeted arrow', () => {
      const result = parseSitemap(
        'sitemap T\n["Order | Items"]\n  Details\nHome\n  -> [Order | Items]'
      );
      expect(result.error).toBeNull();
      expect(result.roots[0].label).toBe('Order | Items');
      expect(result.edges[0].targetId).toBe(result.roots[0].id);
    });

    it('leaves interior quotes untouched', () => {
      const result = parseSitemap(
        'sitemap T\nHome\nsay "hi" loudly\nRef\n  -> say "hi" loudly'
      );
      expect(result.roots[1].label).toBe('say "hi" loudly');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].targetId).toBe(result.roots[1].id);
    });
  });

  // === Metadata ===
  describe('metadata', () => {
    it('key: value attaches to parent node', () => {
      const result = parseSitemap('Home\n  Auth: Public\n  Type: Landing');
      expect(result.roots[0].metadata).toEqual({
        auth: 'Public',
        type: 'Landing',
      });
    });

    it('same-line metadata via declared tag aliases', () => {
      const result = parseSitemap(
        'sitemap\ntag Auth as auth\n  Public blue\ntag Type as type\n  Landing blue\n\nHome auth: Public, type: Landing'
      );
      expect(result.roots[0].metadata).toEqual({
        auth: 'Public',
        type: 'Landing',
      });
    });

    it('metadata with no parent returns error', () => {
      const result = parseSitemap('  Auth: Public');
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  // === Node descriptions ===
  describe('node descriptions', () => {
    it('bare description keyword (no colon) is treated as a child node', () => {
      // The legacy bare `description text` form is removed at 1.0; it no
      // longer attaches as a description and falls through to a child node.
      const result = parseSitemap(
        'sitemap\nHome\n  description Main landing page'
      );
      expect(result.roots[0].description).toBeUndefined();
      expect(result.roots[0].children[0].label).toBe(
        'description Main landing page'
      );
    });

    it('description: with colon is treated as metadata (not dedicated field)', () => {
      const result = parseSitemap(
        'sitemap\nHome\n  description: Main landing page'
      );
      // Colon form matches METADATA_RE, stored in metadata record
      expect(result.roots[0].metadata['description']).toBe('Main landing page');
      // Not extracted to dedicated description field via indented path
      expect(result.roots[0].description).toBeUndefined();
    });

    it('pipe metadata: Node  description: text extracts to dedicated field', () => {
      const result = parseSitemap(
        'sitemap\nHome  description: Main landing page'
      );
      expect(result.roots[0].description).toEqual(['Main landing page']);
      expect(result.roots[0].metadata['description']).toBeUndefined();
    });

    it('multi-line: indented description: lines accumulate in metadata', () => {
      const result = parseSitemap(
        'sitemap\nHome\n  description: First line\n  description: Second line'
      );
      // Indented colon form is stored in the metadata record (last wins).
      expect(result.roots[0].metadata['description']).toBe('Second line');
    });

    it('description on container nodes via same-line metadata', () => {
      const result = parseSitemap(
        'sitemap\n[Navigation] description: Nav group\n  Home'
      );
      const container = result.roots[0];
      expect(container.isContainer).toBe(true);
      expect(container.metadata['description']).toBe('Nav group');
    });

    it('bare description with no text is silently skipped', () => {
      const result = parseSitemap('sitemap\nHome\n  description');
      // Bare "description" with no trailing text — isKeyword: false, treated as child node
      expect(result.roots[0].description).toBeUndefined();
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  // === Arrows ===
  describe('arrows', () => {
    it('bare arrow -> Target', () => {
      const result = parseSitemap('Home\n  -> About\nAbout');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].label).toBeUndefined();
      expect(result.edges[0].sourceId).toBe(result.roots[0].id);
    });

    it('labeled arrow -label-> Target', () => {
      const result = parseSitemap('Home\n  -navigate-> About\nAbout');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].label).toBe('navigate');
    });

    it('-(red)-> parses as literal label "(red)" (spec §1.7: no edge color)', () => {
      const result = parseSitemap('Home\n  -(red)-> About\nAbout');
      expect(result.edges).toHaveLength(1);
      expect((result.edges[0] as { color?: string }).color).toBeUndefined();
      expect(result.edges[0].label).toBe('(red)');
    });

    it('-label blue-> parses with whole-token label "browse blue"', () => {
      const result = parseSitemap('Home\n  -browse blue-> About\nAbout');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].label).toBe('browse blue');
      expect((result.edges[0] as { color?: string }).color).toBeUndefined();
    });

    it('arrow target not found produces error with suggestion', () => {
      const result = parseSitemap('Home\n  -go-> Abot\nAbout');
      expect(
        result.diagnostics.some(
          (d) =>
            d.message.includes('Arrow target "Abot" not found') &&
            d.message.includes('Did you mean')
        )
      ).toBe(true);
    });

    it('arrow target resolution is case-insensitive', () => {
      const result = parseSitemap('Home\n  -go-> about\nAbout');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].targetId).toBeDefined();
    });

    it('arrow with no source produces error', () => {
      const result = parseSitemap('-go-> About\nAbout');
      expect(
        result.diagnostics.some((d) =>
          d.message.includes('must be indented under its source page')
        )
      ).toBe(true);
    });

    it('multiple arrows from same node', () => {
      const result = parseSitemap(
        'Home\n  -a-> About\n  -b-> Blog\nAbout\nBlog'
      );
      expect(result.edges).toHaveLength(2);
      expect(result.edges[0].sourceId).toBe(result.edges[1].sourceId);
    });

    it('arrows inside containers', () => {
      const content = [
        '[Browse]',
        '  Schedule',
        '    -view-> Detail',
        '  Detail',
      ].join('\n');
      const result = parseSitemap(content);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].label).toBe('view');
    });

    it('cross-group arrows', () => {
      const content = [
        '[Group A]',
        '  Page A',
        '    -link-> Page B',
        '[Group B]',
        '  Page B',
        '    -back-> Page A',
      ].join('\n');
      const result = parseSitemap(content);
      expect(result.edges).toHaveLength(2);
    });
  });

  // === Label-inferred edge color is removed per spec §1.7 ===
  describe('label-inferred edge color is removed (spec §1.7)', () => {
    it('-yes-> has no color (label only)', () => {
      const result = parseSitemap('Home\n  -yes-> About\nAbout');
      expect(result.edges[0].label).toBe('yes');
      expect((result.edges[0] as { color?: string }).color).toBeUndefined();
    });

    it('-no-> / -maybe-> / -success-> / -error-> have no color', () => {
      for (const word of ['no', 'maybe', 'success', 'error']) {
        const result = parseSitemap(`Home\n  -${word}-> About\nAbout`);
        expect(result.edges[0].label).toBe(word);
        expect((result.edges[0] as { color?: string }).color).toBeUndefined();
      }
    });
  });

  // === Tag groups ===
  describe('tag groups', () => {
    it('parses tag Name with entries', () => {
      const content = [
        'sitemap',
        'tag Auth',
        '  Public green',
        '  Required blue',
        '',
        'Home',
        '  Auth: Public',
      ].join('\n');
      const result = parseSitemap(content);
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Auth');
      expect(result.tagGroups[0].entries).toHaveLength(2);
    });

    it('validates tag values', () => {
      const content = [
        'tag Auth',
        '  Public green',
        '',
        'Home',
        '  Auth: Secret',
      ].join('\n');
      const result = parseSitemap(content);
      expect(
        result.diagnostics.some(
          (d) =>
            d.severity === 'warning' &&
            d.message.includes("Unknown value 'Secret'")
        )
      ).toBe(true);
    });

    it('tag group after content produces error', () => {
      const content = 'Home\ntag Auth\n  Public green';
      const result = parseSitemap(content);
      expect(
        result.diagnostics.some((d) =>
          d.message.includes('Tag groups must appear before')
        )
      ).toBe(true);
    });

    it('tag group with alias', () => {
      const content = [
        'tag Authorization as auth',
        '  Public green',
        '',
        'Home',
        '  auth: Public',
      ].join('\n');
      const result = parseSitemap(content);
      expect(result.tagGroups[0].alias).toBe('auth');
      // Alias resolves to group name in metadata
      expect(result.roots[0].metadata['authorization']).toBe('Public');
    });
  });

  // === Node color ===
  describe('node color', () => {
    // Sitemap pages have no color slot — use tag groups for coloring.
    // Old `(color)` parens form is now literal label text.
    it('(color) parens suffix on a page is literal', () => {
      const result = parseSitemap('sitemap\nHome(blue)');
      expect(result.roots[0].label).toBe('Home(blue)');
      expect(result.roots[0].color).toBeUndefined();
    });
  });

  // === Options ===
  describe('options', () => {
    it('parses generic options', () => {
      const result = parseSitemap('sitemap\nsome-option value\nHome');
      expect(result.options['some-option']).toBe('value');
    });
  });

  // === Full integration ===
  describe('full sample', () => {
    it('parses baseball tickets sample structure', () => {
      const content = [
        'sitemap Grand Slam Tickets',
        'direction-tb',
        '',
        'tag Auth',
        '  Public green',
        '  Required blue',
        '',
        'Home',
        '  Auth: Public',
        '  -browse-> Game Schedule',
        '  -search-> Search',
        '',
        '[Browse & Discovery]',
        '  Game Schedule',
        '    Auth: Public',
        '    -select game-> Game Detail',
        '',
        '  Search',
        '    Auth: Public',
        '    -results-> Game Detail',
        '',
        '  Game Detail',
        '    Auth: Public',
        '    -buy tickets-> Seat Picker',
        '',
        '[Purchase Flow]',
        '  Seat Picker',
        '    Auth: Public',
        '    -select seats-> Cart',
        '',
        '  Cart',
        '    Auth: Public',
        '    -checkout-> Login',
        '',
        '[Account]',
        '  Login',
        '    Auth: Public',
        '    -success-> My Account',
        '',
        '  My Account',
        '    Auth: Required',
      ].join('\n');

      const result = parseSitemap(content);
      expect(result.error).toBeNull();
      expect(result.title).toBe('Grand Slam Tickets');
      expect(result.direction).toBe('TB');
      expect(result.tagGroups).toHaveLength(1);

      // Home + 3 containers
      expect(result.roots).toHaveLength(4);
      expect(result.roots[0].label).toBe('Home');
      expect(result.roots[1].isContainer).toBe(true);
      expect(result.roots[1].label).toBe('Browse & Discovery');
      expect(result.roots[2].isContainer).toBe(true);
      expect(result.roots[3].isContainer).toBe(true);

      // All edges should resolve
      expect(result.edges.length).toBeGreaterThanOrEqual(7);
      const unresolvedErrors = result.diagnostics.filter((d) =>
        d.message.includes('not found')
      );
      expect(unresolvedErrors).toHaveLength(0);
    });
  });

  // === Group-targeted arrows ===
  describe('group-targeted arrows', () => {
    it('node -> [group]: arrow targets container', () => {
      const content = [
        'Home',
        '  -> [Port Market]',
        '[Port Market]',
        '  Shop',
      ].join('\n');
      const result = parseSitemap(content);
      expect(result.edges).toHaveLength(1);
      const home = result.roots[0];
      const container = result.roots[1];
      expect(container.isContainer).toBe(true);
      expect(result.edges[0].sourceId).toBe(home.id);
      expect(result.edges[0].targetId).toBe(container.id);
    });

    it('[group] -> node: arrow indented under container targets a page', () => {
      const content = ['[Port Market]', '  Shop', '  -> Home', 'Home'].join(
        '\n'
      );
      const result = parseSitemap(content);
      expect(result.edges).toHaveLength(1);
      const container = result.roots[0];
      expect(container.isContainer).toBe(true);
      expect(result.edges[0].sourceId).toBe(container.id);
    });

    it('[group] -> [group]: arrow between containers', () => {
      const content = [
        '[Port Market]',
        '  Shop',
        '  -> [Warehouse]',
        '[Warehouse]',
        '  Storage',
      ].join('\n');
      const result = parseSitemap(content);
      expect(result.edges).toHaveLength(1);
      const portMarket = result.roots[0];
      const warehouse = result.roots[1];
      expect(result.edges[0].sourceId).toBe(portMarket.id);
      expect(result.edges[0].targetId).toBe(warehouse.id);
    });

    it('labeled arrow: -shop-> [Container]', () => {
      const content = [
        'Home',
        '  -shop-> [Port Market]',
        '[Port Market]',
        '  Shop',
      ].join('\n');
      const result = parseSitemap(content);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].label).toBe('shop');
      expect(result.edges[0].targetId).toBe(result.roots[1].id);
    });

    it('error: -> [Nonexistent] produces group-specific error', () => {
      const content = ['Home', '  -> [Nonexistent]'].join('\n');
      const result = parseSitemap(content);
      expect(result.edges).toHaveLength(0);
      expect(
        result.diagnostics.some((d) =>
          d.message.includes("Group '[Nonexistent]' not found")
        )
      ).toBe(true);
    });

    it('same-name collision: node "Foo" and [Foo] resolve separately', () => {
      const content = [
        'Home',
        '  -> Foo',
        '  -> [Foo]',
        'Foo',
        '[Foo]',
        '  Bar',
      ].join('\n');
      const result = parseSitemap(content);
      expect(result.edges).toHaveLength(2);
      // First edge targets the node
      const fooNode = result.roots[1];
      expect(fooNode.label).toBe('Foo');
      expect(fooNode.isContainer).toBe(false);
      expect(result.edges[0].targetId).toBe(fooNode.id);
      // Second edge targets the container
      const fooContainer = result.roots[2];
      expect(fooContainer.label).toBe('Foo');
      expect(fooContainer.isContainer).toBe(true);
      expect(result.edges[1].targetId).toBe(fooContainer.id);
    });

    it('-shop red-> [Container] parses as whole-label "shop red" (no edge color)', () => {
      const content = [
        'Home',
        '  -shop red-> [Port Market]',
        '[Port Market]',
        '  Shop',
      ].join('\n');
      const result = parseSitemap(content);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].label).toBe('shop red');
      expect((result.edges[0] as { color?: string }).color).toBeUndefined();
      expect(result.edges[0].targetId).toBe(result.roots[1].id);
    });

    it('group target resolution is case-insensitive', () => {
      const content = [
        'Home',
        '  -> [port market]',
        '[Port Market]',
        '  Shop',
      ].join('\n');
      const result = parseSitemap(content);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].targetId).toBe(result.roots[1].id);
    });
  });

  // === Container metadata cascading ===
  describe('container metadata cascading', () => {
    it('child inherits container metadata (via declared tag alias)', () => {
      const content = [
        'sitemap',
        'tag Icon as icon',
        '  nav blue',
        '  info blue',
        '',
        '[Browse] icon: nav',
        '  About',
        '  Contact',
      ].join('\n');
      const result = parseSitemap(content);
      expect(result.error).toBeNull();
      const browseContainer = result.roots[0];
      expect(browseContainer.isContainer).toBe(true);
      expect(browseContainer.metadata).toEqual({ icon: 'nav' });
      expect(browseContainer.children[0].label).toBe('About');
      expect(browseContainer.children[0].metadata).toEqual({ icon: 'nav' });
      expect(browseContainer.children[1].label).toBe('Contact');
      expect(browseContainer.children[1].metadata).toEqual({ icon: 'nav' });
    });

    it('child metadata overrides container metadata (via declared tag alias)', () => {
      const content = [
        'sitemap',
        'tag Icon as icon',
        '  nav blue',
        '  info blue',
        '',
        '[Browse] icon: nav',
        '  About icon: info',
        '  Contact',
      ].join('\n');
      const result = parseSitemap(content);
      expect(result.error).toBeNull();
      const browseContainer = result.roots[0];
      expect(browseContainer.children[0].label).toBe('About');
      expect(browseContainer.children[0].metadata).toEqual({ icon: 'info' });
      expect(browseContainer.children[1].label).toBe('Contact');
      expect(browseContainer.children[1].metadata).toEqual({ icon: 'nav' });
    });
  });

  describe('flat-container rule', () => {
    it('errors on a page nested under a page inside a container', () => {
      const content = [
        'sitemap',
        '[Marketing]',
        '  Docs',
        '    Guides',
        '    API Reference',
        '  Blog',
      ].join('\n');
      const result = parseSitemap(content);
      expect(result.error).toMatch(/cannot have indented sub-pages/);
      const errs = result.diagnostics.filter((d) => d.severity === 'error');
      expect(errs.map((d) => d.line)).toEqual([4, 5]);
      expect(errs[0].message).toContain('[Marketing]');
    });

    it('allows a flat list of pages inside a container', () => {
      const content = ['sitemap', '[Marketing]', '  Docs', '  Blog'].join('\n');
      const result = parseSitemap(content);
      expect(result.error).toBeNull();
    });

    it('allows top-level page nesting (not inside a container)', () => {
      const content = ['sitemap', 'Home', '  Pricing', '    Enterprise'].join(
        '\n'
      );
      const result = parseSitemap(content);
      expect(result.error).toBeNull();
    });

    it('allows indented arrows under a page inside a container', () => {
      const content = [
        'sitemap',
        '[Workspace]',
        '  Dashboard',
        '    -projects-> Projects',
        '  Projects',
      ].join('\n');
      const result = parseSitemap(content);
      expect(result.error).toBeNull();
      expect(result.edges).toHaveLength(1);
    });
  });
});

describe('looksLikeSitemap', () => {
  it('returns true for sitemap-like content', () => {
    const content = [
      'Home',
      '  -browse-> Schedule',
      '[Browse]',
      '  Schedule',
    ].join('\n');
    expect(looksLikeSitemap(content)).toBe(true);
  });

  it('returns false without arrows', () => {
    const content = '[Group]\n  Node A\n  Node B';
    expect(looksLikeSitemap(content)).toBe(false);
  });

  it('returns false without containers', () => {
    const content = 'Home\n  -go-> About\nAbout';
    expect(looksLikeSitemap(content)).toBe(false);
  });

  it('returns false for flowchart content', () => {
    const content = '[Start] -yes-> [End]';
    expect(looksLikeSitemap(content)).toBe(false);
  });
});
