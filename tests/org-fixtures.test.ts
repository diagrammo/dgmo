import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseOrg } from '../src/org/parser';

const FIXTURE_DIR = resolve(__dirname, '../gallery/fixtures');

const FIXTURE_FILES = ['org-basic.dgmo', 'org-teams.dgmo', 'org-full.dgmo'];

describe('org fixtures', () => {
  for (const file of FIXTURE_FILES) {
    it(`${file} parses without errors`, () => {
      const content = readFileSync(resolve(FIXTURE_DIR, file), 'utf-8');
      const result = parseOrg(content);
      expect(result.error).toBeFalsy();
      expect(result.roots.length).toBeGreaterThan(0);
    });
  }

  it('org-basic has title "Small Startup" and at least 1 root', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'org-basic.dgmo'), 'utf-8');
    const result = parseOrg(content);
    expect(result.title).toBe('Small Startup');
    expect(result.roots.length).toBeGreaterThanOrEqual(1);
  });

  it('org-teams has containers', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'org-teams.dgmo'), 'utf-8');
    const result = parseOrg(content);

    function hasContainer(nodes: typeof result.roots): boolean {
      for (const node of nodes) {
        if (node.isContainer) return true;
        if (node.children && hasContainer(node.children)) return true;
      }
      return false;
    }

    expect(hasContainer(result.roots)).toBe(true);
  });

  it('org-full has tag groups defined', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'org-full.dgmo'), 'utf-8');
    const result = parseOrg(content);
    expect(result.tagGroups).toBeDefined();
    expect(result.tagGroups!.length).toBeGreaterThan(0);
  });
});
