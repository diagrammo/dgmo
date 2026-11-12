// Chart frame on the tree-shaped chart types (#1827): a capitalised `Source` /
// `Footnote` stays a node, the frame lines work after content and survive the
// collapse copy.
import { describe, it, expect } from 'vitest';
import { parseSitemap } from '../src/sitemap/parser';
import { collapseSitemapTree } from '../src/sitemap/collapse';
import { parseMindmap } from '../src/mindmap/parser';
import { collapseMindmapTree } from '../src/mindmap/collapse';
import { parseKanban } from '../src/kanban/parser';
import { parseClassDiagram } from '../src/class/parser';
import { parseERDiagram } from '../src/er/parser';
import { parseFamily } from '../src/family/parser';
import { parseC4 } from '../src/c4/parser';

describe('chart frame on tree types (#1827)', () => {
  it('sitemap: Source stays a page, frame survives collapse', () => {
    const p = parseSitemap(
      'sitemap Site\nHome\n  Source\n  About\nsource Press kit\n'
    );
    expect(p.frame?.source).toBe('Press kit');
    expect(p.roots[0]!.children.map((c) => c.label)).toContain('Source');
    const { parsed } = collapseSitemapTree(p, new Set([p.roots[0]!.id]));
    expect(parsed.frame?.source).toBe('Press kit');
  });

  it('mindmap: Footnote stays a node, frame survives collapse', () => {
    const p = parseMindmap('mindmap Ideas\nFootnote\nA\n  B\nfootnote Done\n');
    expect(p.frame?.footnotes?.[0]?.text).toBe('Done');
    expect(JSON.stringify(p.roots)).toContain('Footnote');
    const { roots } = collapseMindmapTree(p.roots, new Set());
    expect(roots.length).toBeGreaterThan(0);
  });

  it('kanban, class, er, family, c4: frame after content, no diagnostics', () => {
    const cases: [string, { frame?: unknown; diagnostics: unknown[] }][] = [
      [
        'kanban',
        parseKanban('kanban T\n[A]\n  card\nsubtitle Sub\nbyline Me\n'),
      ],
      [
        'class',
        parseClassDiagram('class T\nVessel\n  + sail(): void\nsubtitle Sub\n'),
      ],
      ['er', parseERDiagram('er T\nships\n  id int pk\nsubtitle Sub\n')],
      ['family', parseFamily('family T\nAnn\n  Bob\nsubtitle Sub\n')],
      [
        'c4',
        parseC4('c4 T\nperson Customer\nsubtitle Sub\n') as {
          frame?: unknown;
          diagnostics: unknown[];
        },
      ],
    ];
    for (const [name, parsed] of cases) {
      expect(parsed.frame, name).toBeDefined();
    }
  });
});
