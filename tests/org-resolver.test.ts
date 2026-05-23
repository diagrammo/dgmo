import { describe, it, expect } from 'vitest';
import { resolveOrgImports } from '../src/org/resolver';
import type { ReadFileFn } from '../src/org/resolver';
import { parseOrg } from '../src/org/parser';

// ============================================================
// Mock reader
// ============================================================

function mockReader(files: Record<string, string>): ReadFileFn {
  return (path) => {
    if (!(path in files)) throw new Error(`Not found: ${path}`);
    return files[path];
  };
}

// ============================================================
// Tests
// ============================================================

describe('resolveOrgImports', () => {
  // ----------------------------------------------------------
  // 1. No-op: no imports, no tags
  // ----------------------------------------------------------
  it('passes through content unchanged when no imports or tags', async () => {
    const content = `org Simple

Alice
  Bob`;
    const result = await resolveOrgImports(
      content,
      '/proj/org.dgmo',
      mockReader({})
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.content).toContain('Alice');
    expect(result.content).toContain('Bob');
  });

  // ----------------------------------------------------------
  // 2. tags loads tag groups from external file
  // ----------------------------------------------------------
  it('loads tag groups from external tags file', async () => {
    const tagsFile = `tag Department
  Engineering blue
  Product green`;

    const content = `org Test
tags shared-tags.dgmo

Alice  department: Engineering`;

    const reader = mockReader({
      '/proj/shared-tags.dgmo': tagsFile,
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);
    expect(result.content).toContain('tag Department');
    expect(result.content).toContain('Engineering blue');
    expect(result.content).toContain('Alice  department: Engineering');
    // tags directive should be stripped
    expect(result.content).not.toMatch(/^tags\s+\S+\.dgmo/m);
  });

  // ----------------------------------------------------------
  // 3. Inline tag groups override same-name from tags file
  // ----------------------------------------------------------
  it('inline tag groups override same-name groups from tags file', async () => {
    const tagsFile = `tag Department
  Engineering blue
  Product green`;

    const content = `org
tags shared-tags.dgmo

tag Department
  Engineering red
  Sales purple

Alice  department: Engineering`;

    const reader = mockReader({
      '/proj/shared-tags.dgmo': tagsFile,
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);
    // Should have the inline version red not the tags file version blue
    expect(result.content).toContain('Engineering red');
    expect(result.content).not.toContain('Engineering blue');
  });

  // ----------------------------------------------------------
  // 4. tags file with non-tag content — only tag blocks extracted
  // ----------------------------------------------------------
  it('extracts only tag groups from a tags file that has other content', async () => {
    const tagsFile = `org Other Chart

tag Department
  Engineering blue

CEO
  CTO`;

    const content = `org
tags other.dgmo

Alice`;

    const reader = mockReader({
      '/proj/other.dgmo': tagsFile,
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);
    expect(result.content).toContain('tag Department');
    expect(result.content).toContain('Engineering blue');
    expect(result.content).toContain('Alice');
    // The non-tag content from the tags file should NOT be included
    expect(result.content).not.toContain('CEO');
    expect(result.content).not.toContain('CTO');
  });

  // ----------------------------------------------------------
  // 5. tags file not found → diagnostic, proceeds without
  // ----------------------------------------------------------
  it('produces diagnostic when tags file not found', async () => {
    const content = `org
tags missing.dgmo

Alice`;

    const result = await resolveOrgImports(
      content,
      '/proj/org.dgmo',
      mockReader({})
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('Tags file not found');
    expect(result.content).toContain('Alice');
  });

  // ----------------------------------------------------------
  // 6. Single import grafts content at correct indentation
  // ----------------------------------------------------------
  it('grafts imported content at correct indentation', async () => {
    const teamFile = `org Platform Team

Alice Chen  role: Staff Eng
Bob Rivera  role: Senior Eng`;

    const content = `org

CEO
  CTO
    import teams/platform.dgmo`;

    const reader = mockReader({
      '/proj/teams/platform.dgmo': teamFile,
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);
    // Content should be re-indented under CTO
    expect(result.content).toContain('    Alice Chen  role: Staff Eng');
    expect(result.content).toContain('    Bob Rivera  role: Senior Eng');
    expect(result.content).not.toMatch(/import\s+\S+\.dgmo/);
  });

  // ----------------------------------------------------------
  // 7. Multiple imports under same parent
  // ----------------------------------------------------------
  it('handles multiple imports under the same parent', async () => {
    const team1 = `Alice`;
    const team2 = `Bob`;

    const content = `org

CEO
  import team1.dgmo
  import team2.dgmo`;

    const reader = mockReader({
      '/proj/team1.dgmo': team1,
      '/proj/team2.dgmo': team2,
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);
    expect(result.content).toContain('  Alice');
    expect(result.content).toContain('  Bob');
  });

  // ----------------------------------------------------------
  // 8. Import mixed with regular children
  // ----------------------------------------------------------
  it('handles imports mixed with regular children', async () => {
    const teamFile = `Charlie`;

    const content = `org

CEO
  Alice
  import team.dgmo
  Bob`;

    const reader = mockReader({
      '/proj/team.dgmo': teamFile,
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);
    expect(result.content).toContain('  Alice');
    expect(result.content).toContain('  Charlie');
    expect(result.content).toContain('  Bob');
  });

  // ----------------------------------------------------------
  // 9. Imported file's header directives stripped
  // ----------------------------------------------------------
  it('strips header directives from imported files', async () => {
    const teamFile = `org Platform Team
hide role

Alice Chen  role: Staff Eng`;

    const content = `org

CEO
  import team.dgmo`;

    const reader = mockReader({
      '/proj/team.dgmo': teamFile,
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);
    expect(result.content).toContain('  Alice Chen  role: Staff Eng');
    // Header lines from imported file should be stripped
    expect(result.content).not.toMatch(/Platform Team/m);
    // org from parent is fine
    expect(result.content).toMatch(/^org$/m);
  });

  // ----------------------------------------------------------
  // 10. Nested imports: A→B→C, indentation accumulates
  // ----------------------------------------------------------
  it('resolves nested imports with accumulated indentation', async () => {
    const fileC = `Charlie`;

    const fileB = `Bob
  import c.dgmo`;

    const content = `org

Alice
  import b.dgmo`;

    const reader = mockReader({
      '/proj/b.dgmo': fileB,
      '/proj/c.dgmo': fileC,
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);
    expect(result.content).toContain('  Bob');
    expect(result.content).toContain('    Charlie');
  });

  // ----------------------------------------------------------
  // 11. Tag group merging: parent inline > tags file > imported
  // ----------------------------------------------------------
  it('merges tag groups with correct precedence', async () => {
    const tagsFile = `tag Department
  Engineering blue

tag Location
  NY (nord-8)`;

    const importedFile = `tag Department
  Engineering green

tag Status
  Active yellow

Alice`;

    const content = `org
tags tags.dgmo

tag Department
  Engineering red

CEO
  import imported.dgmo`;

    const reader = mockReader({
      '/proj/tags.dgmo': tagsFile,
      '/proj/imported.dgmo': importedFile,
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);
    // Inline wins for Department red
    expect(result.content).toContain('Engineering red');
    expect(result.content).not.toContain('Engineering blue');
    expect(result.content).not.toContain('Engineering green');
    // Location from tags file
    expect(result.content).toContain('NY (nord-8)');
    // Status from imported file (additive)
    expect(result.content).toContain('Active yellow');
  });

  // ----------------------------------------------------------
  // 12. New groups from imported files added (no conflict)
  // ----------------------------------------------------------
  it('adds new tag groups from imported files', async () => {
    const importedFile = `tag Role
  Manager orange

Alice  role: Manager`;

    const content = `org

tag Department
  Engineering blue

CEO
  import team.dgmo`;

    const reader = mockReader({
      '/proj/team.dgmo': importedFile,
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);
    expect(result.content).toContain('tag Department');
    expect(result.content).toContain('tag Role');
    expect(result.content).toContain('Manager orange');
  });

  // ----------------------------------------------------------
  // 13. Imported file with tags — its tags resolved before merging up
  // ----------------------------------------------------------
  it('resolves tags in imported files before merging', async () => {
    const sharedTags = `tag Department
  Engineering blue`;

    const importedFile = `org
tags ../shared-tags.dgmo

Alice  department: Engineering`;

    const content = `org

CEO
  import teams/eng.dgmo`;

    const reader = mockReader({
      '/proj/shared-tags.dgmo': sharedTags,
      '/proj/teams/eng.dgmo': importedFile,
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);
    expect(result.content).toContain('tag Department');
    expect(result.content).toContain('  Alice  department: Engineering');
  });

  // ----------------------------------------------------------
  // 14. Circular import: A→B→A detected with error
  // ----------------------------------------------------------
  it('detects circular imports', async () => {
    const fileB = `Bob
  import a.dgmo`;

    const content = `org

Alice
  import b.dgmo`;

    const reader = mockReader({
      '/proj/a.dgmo': content,
      '/proj/b.dgmo': fileB,
    });

    const result = await resolveOrgImports(content, '/proj/a.dgmo', reader);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(
      result.diagnostics.some((d) => d.message.includes('Circular import'))
    ).toBe(true);
  });

  // ----------------------------------------------------------
  // 15. Diamond: A→B,C both→D works (no false cycle)
  // ----------------------------------------------------------
  it('allows diamond imports (not a cycle)', async () => {
    const fileD = `Dave`;
    const fileB = `Bob
  import d.dgmo`;
    const fileC = `Carol
  import d.dgmo`;

    const content = `org

Alice
  import b.dgmo
  import c.dgmo`;

    const reader = mockReader({
      '/proj/b.dgmo': fileB,
      '/proj/c.dgmo': fileC,
      '/proj/d.dgmo': fileD,
    });

    const result = await resolveOrgImports(content, '/proj/a.dgmo', reader);
    expect(result.diagnostics).toEqual([]);
    expect(result.content).toContain('  Bob');
    expect(result.content).toContain('  Carol');
    // Dave appears twice (once under each)
    const daveMatches = result.content.match(/Dave/g);
    expect(daveMatches?.length).toBe(2);
  });

  // ----------------------------------------------------------
  // 16. File not found → diagnostic, rest renders
  // ----------------------------------------------------------
  it('produces diagnostic for missing import, continues rendering', async () => {
    const content = `org

CEO
  import missing.dgmo
  Alice`;

    const result = await resolveOrgImports(
      content,
      '/proj/org.dgmo',
      mockReader({})
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('Import file not found');
    expect(result.content).toContain('Alice');
  });

  // ----------------------------------------------------------
  // 17. Empty imported file → no content added
  // ----------------------------------------------------------
  it('handles empty imported files gracefully', async () => {
    const content = `org

CEO
  import empty.dgmo
  Alice`;

    const reader = mockReader({
      '/proj/empty.dgmo': '',
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);
    expect(result.content).toContain('Alice');
    expect(result.content).not.toMatch(/import\s+\S+\.dgmo/);
  });

  // ----------------------------------------------------------
  // 18. ./ and ../ paths resolve correctly
  // ----------------------------------------------------------
  it('resolves relative paths with ./ and ../', async () => {
    const siblingFile = `Charlie`;
    const parentFile = `Dave`;

    const content = `org

Alice
  import ./sibling.dgmo
  import ../parent.dgmo`;

    const reader = mockReader({
      '/proj/sub/sibling.dgmo': siblingFile,
      '/proj/parent.dgmo': parentFile,
    });

    const result = await resolveOrgImports(
      content,
      '/proj/sub/org.dgmo',
      reader
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.content).toContain('  Charlie');
    expect(result.content).toContain('  Dave');
  });

  // ----------------------------------------------------------
  // 19. Integration: merged output parses correctly with parseOrg()
  // ----------------------------------------------------------
  it('produces output that parses correctly with parseOrg', async () => {
    const tagsFile = `tag Department
  Engineering blue
  Product green`;

    const teamFile = `[Platform Team]
  Alice Chen  department: Engineering
  Bob Rivera  department: Engineering`;

    const content = `org Acme Corp
tags company-tags.dgmo

CEO  department: Engineering
  CTO  department: Engineering
    import teams/platform.dgmo
  VP Product  department: Product`;

    const reader = mockReader({
      '/proj/company-tags.dgmo': tagsFile,
      '/proj/teams/platform.dgmo': teamFile,
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);

    // Parse the merged output
    const parsed = parseOrg(result.content);
    expect(parsed.error).toBeNull();
    expect(parsed.title).toBe('Acme Corp');
    expect(parsed.tagGroups).toHaveLength(1);
    expect(parsed.tagGroups[0].name).toBe('Department');
    expect(parsed.roots).toHaveLength(1);
    expect(parsed.roots[0].label).toBe('CEO');
    // CTO should have Platform Team container as child
    const cto = parsed.roots[0].children[0];
    expect(cto.label).toBe('CTO');
    expect(cto.children.length).toBeGreaterThanOrEqual(1);
  });

  // ----------------------------------------------------------
  // 20. tag syntax in tags file
  // ----------------------------------------------------------
  it('loads tag groups from tags file using tag syntax', async () => {
    const tagsFile = `tag Department
  Engineering blue
  Product green`;

    const content = `org Test
tags shared-tags.dgmo

Alice  department: Engineering`;

    const reader = mockReader({
      '/proj/shared-tags.dgmo': tagsFile,
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);
    expect(result.content).toContain('tag Department');
    expect(result.content).toContain('Engineering blue');
  });

  // ----------------------------------------------------------
  // 21. Merges tag groups across files
  // ----------------------------------------------------------
  it('merges tag groups across imported files', async () => {
    const importedFile = `tag Role
  Manager orange

Alice  role: Manager`;

    const content = `org

tag Department
  Engineering blue

CEO
  import team.dgmo`;

    const reader = mockReader({
      '/proj/team.dgmo': importedFile,
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);
    expect(result.content).toContain('tag Department');
    expect(result.content).toContain('tag Role');
    expect(result.content).toContain('Manager orange');
  });

  // ----------------------------------------------------------
  // 22. Inline tag groups override same-name from tags file
  // ----------------------------------------------------------
  it('inline tag groups override same-name groups from tags file', async () => {
    const tagsFile = `tag Department
  Engineering blue
  Product green`;

    const content = `org
tags shared-tags.dgmo

tag Department
  Engineering red
  Sales purple

Alice  department: Engineering`;

    const reader = mockReader({
      '/proj/shared-tags.dgmo': tagsFile,
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);
    expect(result.content).toContain('Engineering red');
    expect(result.content).not.toContain('Engineering blue');
  });

  // ----------------------------------------------------------
  // 23. importSourceMap: non-imported lines have null
  // ----------------------------------------------------------
  it('importSourceMap is null for non-imported lines', async () => {
    const content = `org Simple

Alice
  Bob`;
    const result = await resolveOrgImports(
      content,
      '/proj/org.dgmo',
      mockReader({})
    );
    expect(result.importSourceMap).toBeDefined();
    // All entries should be null (no imports)
    for (let i = 1; i < result.importSourceMap.length; i++) {
      expect(result.importSourceMap[i]).toBeNull();
    }
  });

  // ----------------------------------------------------------
  // 24. importSourceMap: imported lines point to source file + line
  // ----------------------------------------------------------
  it('importSourceMap points to source file and line for imported content', async () => {
    const teamFile = `org Platform Team
Alice Chen
Bob Rivera`;

    const content = `org

CEO
  import team.dgmo`;

    const reader = mockReader({
      '/proj/team.dgmo': teamFile,
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);

    // Find imported lines in resolved content
    const lines = result.content.split('\n');
    const aliceIdx = lines.findIndex((l) => l.includes('Alice Chen'));
    const bobIdx = lines.findIndex((l) => l.includes('Bob Rivera'));
    expect(aliceIdx).toBeGreaterThan(0);
    expect(bobIdx).toBeGreaterThan(0);

    // importSourceMap uses 1-based indexing
    const aliceSource = result.importSourceMap[aliceIdx + 1];
    const bobSource = result.importSourceMap[bobIdx + 1];

    expect(aliceSource).not.toBeNull();
    expect(aliceSource!.filePath).toBe('/proj/team.dgmo');
    expect(aliceSource!.sourceLine).toBe(2); // "Alice Chen" is line 2 in team.dgmo

    expect(bobSource).not.toBeNull();
    expect(bobSource!.filePath).toBe('/proj/team.dgmo');
    expect(bobSource!.sourceLine).toBe(3); // "Bob Rivera" is line 3 in team.dgmo
  });

  // ----------------------------------------------------------
  // 25. importSourceMap: nested imports point to deepest source
  // ----------------------------------------------------------
  it('importSourceMap tracks through nested imports to deepest source', async () => {
    const fileC = `Charlie`;

    const fileB = `Bob
  import c.dgmo`;

    const content = `org

Alice
  import b.dgmo`;

    const reader = mockReader({
      '/proj/b.dgmo': fileB,
      '/proj/c.dgmo': fileC,
    });

    const result = await resolveOrgImports(content, '/proj/a.dgmo', reader);
    expect(result.diagnostics).toEqual([]);

    const lines = result.content.split('\n');
    const charlieIdx = lines.findIndex((l) => l.includes('Charlie'));
    expect(charlieIdx).toBeGreaterThan(0);

    // Charlie comes from c.dgmo (deepest source), not b.dgmo
    const charlieSource = result.importSourceMap[charlieIdx + 1];
    expect(charlieSource).not.toBeNull();
    expect(charlieSource!.filePath).toBe('/proj/c.dgmo');
    expect(charlieSource!.sourceLine).toBe(1); // "Charlie" is line 1 in c.dgmo
  });

  // ----------------------------------------------------------
  // 26. importSourceMap: non-imported lines remain null even with imports present
  // ----------------------------------------------------------
  it('importSourceMap is null for non-imported lines when imports exist', async () => {
    const teamFile = `Alice`;

    const content = `org

CEO
  import team.dgmo
  Bob`;

    const reader = mockReader({
      '/proj/team.dgmo': teamFile,
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);

    const lines = result.content.split('\n');

    // CEO and Bob are from the main file — should be null
    const ceoIdx = lines.findIndex((l) => l.trim() === 'CEO');
    const bobIdx = lines.findIndex((l) => l.includes('Bob'));
    expect(result.importSourceMap[ceoIdx + 1]).toBeNull();
    expect(result.importSourceMap[bobIdx + 1]).toBeNull();

    // Alice is imported — should have source
    const aliceIdx = lines.findIndex((l) => l.includes('Alice'));
    expect(result.importSourceMap[aliceIdx + 1]).not.toBeNull();
    expect(result.importSourceMap[aliceIdx + 1]!.filePath).toBe(
      '/proj/team.dgmo'
    );
  });

  // ----------------------------------------------------------
  // Backward compat: colon syntax still works
  // ----------------------------------------------------------
  it('still accepts tags: and import: with colon for backward compat', async () => {
    const tagsFile = `tag Department
  Engineering blue`;

    const content = `org Test
tags: shared-tags.dgmo

CEO
  import: team.dgmo`;

    const teamFile = `Alice`;

    const reader = mockReader({
      '/proj/shared-tags.dgmo': tagsFile,
      '/proj/team.dgmo': teamFile,
    });

    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);
    expect(result.content).toContain('tag Department');
    expect(result.content).toContain('  Alice');
  });

  // ----------------------------------------------------------
  // Regression: title on first line with trailing whitespace
  // ----------------------------------------------------------
  it('preserves title from first line with trailing whitespace', async () => {
    const tagsFile = `tag Status s\n  Active green\n  Inactive gray\n`;
    const content = `org My Org \nsub-node-label Reports\ntags tags.dgmo\n\nAlice\n  Bob\n`;

    const reader = mockReader({ '/proj/tags.dgmo': tagsFile });
    const result = await resolveOrgImports(content, '/proj/org.dgmo', reader);
    expect(result.diagnostics).toEqual([]);

    const parsed = parseOrg(result.content);
    expect(parsed.title).toBe('My Org');
  });
});
