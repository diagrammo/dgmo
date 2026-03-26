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
      expect(result.direction).toBe('TB');
    });

    it('parses direction LR', () => {
      const result = parseSitemap('sitemap\ndirection LR\nHome');
      expect(result.direction).toBe('LR');
    });

    it('parses direction TB', () => {
      const result = parseSitemap('sitemap\ndirection TB\nHome');
      expect(result.direction).toBe('TB');
    });

    it('accepts orientation as alias for direction', () => {
      const result = parseSitemap('sitemap\norientation horizontal\nHome');
      expect(result.direction).toBe('LR');
    });

    it('normalizes direction vertical to TB', () => {
      const result = parseSitemap('sitemap\ndirection vertical\nHome');
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

    it('container with color', () => {
      const result = parseSitemap('[Group(blue)]');
      expect(result.roots[0].isContainer).toBe(true);
      expect(result.roots[0].label).toBe('Group');
      expect(result.roots[0].color).toBeDefined();
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

    it('pipe-delimited metadata', () => {
      const result = parseSitemap('Home | Auth: Public, Type: Landing');
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

    it('colored arrow -(red)-> Target', () => {
      const result = parseSitemap('Home\n  -(red)-> About\nAbout');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].color).toBeDefined();
      expect(result.edges[0].label).toBeUndefined();
    });

    it('labeled and colored arrow -label(blue)-> Target', () => {
      const result = parseSitemap('Home\n  -browse(blue)-> About\nAbout');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].label).toBe('browse');
      expect(result.edges[0].color).toBeDefined();
    });

    it('arrow target not found produces error with suggestion', () => {
      const result = parseSitemap('Home\n  -go-> Abot\nAbout');
      expect(result.diagnostics.some(d =>
        d.message.includes('Arrow target "Abot" not found') &&
        d.message.includes('Did you mean')
      )).toBe(true);
    });

    it('arrow target resolution is case-insensitive', () => {
      const result = parseSitemap('Home\n  -go-> about\nAbout');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].targetId).toBeDefined();
    });

    it('arrow with no source produces error', () => {
      const result = parseSitemap('-go-> About\nAbout');
      expect(result.diagnostics.some(d =>
        d.message.includes('Arrow has no source')
      )).toBe(true);
    });

    it('multiple arrows from same node', () => {
      const result = parseSitemap('Home\n  -a-> About\n  -b-> Blog\nAbout\nBlog');
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

  // === Arrow color inference ===
  describe('arrow color inference', () => {
    it('-yes-> infers green', () => {
      const result = parseSitemap('Home\n  -yes-> About\nAbout');
      expect(result.edges[0].color).toBe('green');
    });

    it('-no-> infers red', () => {
      const result = parseSitemap('Home\n  -no-> About\nAbout');
      expect(result.edges[0].color).toBe('red');
    });

    it('-maybe-> infers orange', () => {
      const result = parseSitemap('Home\n  -maybe-> About\nAbout');
      expect(result.edges[0].color).toBe('orange');
    });

    it('-YES-> infers green (case-insensitive)', () => {
      const result = parseSitemap('Home\n  -YES-> About\nAbout');
      expect(result.edges[0].color).toBe('green');
    });

    it('-yesterday-> does NOT infer color (not exact match)', () => {
      const result = parseSitemap('Home\n  -yesterday-> About\nAbout');
      expect(result.edges[0].color).toBeUndefined();
    });

    it('-no(blue)-> uses explicit blue, not inferred red', () => {
      const result = parseSitemap('Home\n  -no(blue)-> About\nAbout');
      expect(result.edges[0].color).toBeDefined();
      expect(result.edges[0].color).not.toBe('red');
    });

    it('-success-> infers green', () => {
      const result = parseSitemap('Home\n  -success-> About\nAbout');
      expect(result.edges[0].color).toBe('green');
    });

    it('-error-> infers red', () => {
      const result = parseSitemap('Home\n  -error-> About\nAbout');
      expect(result.edges[0].color).toBe('red');
    });
  });

  // === Tag groups ===
  describe('tag groups', () => {
    it('parses tag: Name with entries', () => {
      const content = [
        'sitemap',
        'tag: Auth',
        '  Public(green)',
        '  Required(blue)',
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
        'tag: Auth',
        '  Public(green)',
        '',
        'Home',
        '  Auth: Secret',
      ].join('\n');
      const result = parseSitemap(content);
      expect(result.diagnostics.some(d =>
        d.severity === 'warning' && d.message.includes("Unknown value 'Secret'")
      )).toBe(true);
    });

    it('tag group after content produces error', () => {
      const content = 'Home\ntag: Auth\n  Public(green)';
      const result = parseSitemap(content);
      expect(result.diagnostics.some(d =>
        d.message.includes('Tag groups must appear before')
      )).toBe(true);
    });

    it('tag group with alias', () => {
      const content = [
        'tag: Authorization alias auth',
        '  Public(green)',
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
    it('parses trailing (color) on page', () => {
      const result = parseSitemap('Home(blue)');
      expect(result.roots[0].label).toBe('Home');
      expect(result.roots[0].color).toBeDefined();
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
        'direction TB',
        '',
        'tag: Auth',
        '  Public(green)',
        '  Required(blue)',
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
      const unresolvedErrors = result.diagnostics.filter(d =>
        d.message.includes('not found')
      );
      expect(unresolvedErrors).toHaveLength(0);
    });
  });

  // === Container metadata cascading ===
  describe('container metadata cascading', () => {
    it('child inherits container metadata', () => {
      const content = [
        '[Browse] | icon: nav',
        '  About',
        '  Contact',
      ].join('\n');
      const result = parseSitemap(content);
      expect(result.error).toBeNull();
      const browseContainer = result.roots[0];
      expect(browseContainer.isContainer).toBe(true);
      expect(browseContainer.metadata).toEqual({ icon: 'nav' });
      // Children should inherit container metadata
      expect(browseContainer.children[0].label).toBe('About');
      expect(browseContainer.children[0].metadata).toEqual({ icon: 'nav' });
      expect(browseContainer.children[1].label).toBe('Contact');
      expect(browseContainer.children[1].metadata).toEqual({ icon: 'nav' });
    });

    it('child metadata overrides container metadata', () => {
      const content = [
        '[Browse] | icon: nav',
        '  About | icon: info',
        '  Contact',
      ].join('\n');
      const result = parseSitemap(content);
      expect(result.error).toBeNull();
      const browseContainer = result.roots[0];
      // About has its own icon, should override
      expect(browseContainer.children[0].label).toBe('About');
      expect(browseContainer.children[0].metadata).toEqual({ icon: 'info' });
      // Contact inherits container metadata
      expect(browseContainer.children[1].label).toBe('Contact');
      expect(browseContainer.children[1].metadata).toEqual({ icon: 'nav' });
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
