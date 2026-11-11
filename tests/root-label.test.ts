import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMapData } from '../src/map/load-data';
import { render } from '../src/render';
import { parseFirstLine } from '../src/utils/parsing';
import { applyRootA11y } from '../src/utils/root-a11y';

// diagrammo/diagrammo#948 — the root aria-label names what the diagram shows:
// `<title> — <Type> diagram` when it sets a title, `<Type> diagram` when not.

/** Types whose renderer writes its own, richer root label (left untouched). */
const OWN_LABEL = ['bracket', 'clock', 'countdown', 'goal'];

const GALLERY_DIR = join(__dirname, '..', 'gallery', 'fixtures');
const fixtures = readdirSync(GALLERY_DIR, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.dgmo'))
  .map((f) => {
    const content = readFileSync(join(GALLERY_DIR, f), 'utf8');
    const first = content
      .split('\n')
      .find((l) => l.trim() && !l.trim().startsWith('//'));
    const declared = parseFirstLine(first ?? '');
    return {
      file: f,
      content,
      type: declared?.chartType ?? null,
      title: declared?.title ?? null,
    };
  })
  .filter((f) => f.type && !OWN_LABEL.includes(f.type));

function rootLabel(svg: string): string | null {
  const root = svg.match(/<svg\b[^>]*>/)![0];
  return /\baria-label="([^"]*)"/.exec(root)?.[1] ?? null;
}

describe('root aria-label names the diagram (#948)', () => {
  it('the gallery has titled and untitled fixtures to check', () => {
    expect(fixtures.filter((f) => f.title).length).toBeGreaterThan(50);
    expect(fixtures.filter((f) => !f.title).length).toBeGreaterThan(0);
  });

  it.each(fixtures.map((f) => [f.file, f.title, f.content] as const))(
    '%s: the label leads with its title',
    async (_file, title, content) => {
      // A map draws nothing without its basemap; every other type needs none.
      const { svg } = await render(content, { mapData: loadMapData });
      const label = rootLabel(svg);
      const typeLabel = /^[A-Z][\w-]* diagram$/;
      if (!title) {
        expect(label).toMatch(typeLabel);
        return;
      }
      const escaped = title
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      expect(label?.startsWith(`${escaped} — `)).toBe(true);
      expect(label!.slice(escaped.length + 3)).toMatch(typeLabel);
    }
  );

  it('a title option line names a gantt as well as line 1 does', async () => {
    const { svg } = await render(
      'gantt\ntitle Harbour Refit\nstart 2026-01-05\n\nHull 5d\nMasts 3d'
    );
    expect(rootLabel(svg)).toBe('Harbour Refit — Gantt diagram');
  });

  it.each([
    ['flowchart', 'flowchart\ntitle Unseen\n\n[Start] -> [End]'],
    ['state', 'state\ntitle Unseen\n\n[Idle] -> [Busy]'],
  ])(
    'a %s body title line, which draws nothing, stays out of the label',
    async (type, content) => {
      const { svg } = await render(content);
      expect(rootLabel(svg)).toBe(
        `${type.charAt(0).toUpperCase()}${type.slice(1)} diagram`
      );
    }
  );

  it('escapes the title inside the attribute', () => {
    const svg = applyRootA11y(
      '<svg viewBox="0 0 1 1"></svg>',
      'flowchart',
      'A "<b>" & Co'
    );
    expect(rootLabel(svg)).toBe(
      'A &quot;&lt;b&gt;&quot; &amp; Co — Flowchart diagram'
    );
  });

  it('keeps the bare chart type with no title', () => {
    const svg = applyRootA11y(
      '<svg viewBox="0 0 1 1"></svg>',
      'sequence',
      null
    );
    expect(rootLabel(svg)).toBe('Sequence diagram');
  });
});

// diagrammo/diagrammo#1868 — a `$'` or `$&` in a title is a replacement pattern
// when spliced as a STRING, and copied the root tag's attributes (or the rest
// of the document) into the aria-label.
describe('a replacement pattern in the title stays literal (#1868)', () => {
  it.each(["Foo$'", 'Foo$&', 'Foo$`', 'Foo$$'])(
    'title %s lands in the label verbatim',
    (title) => {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="10"><g/></svg>';
      const out = applyRootA11y(svg, 'pie', title);
      const root = out.match(/<svg\b[^>]*>/)![0];
      const escaped = title.replace(/&/g, '&amp;');
      expect(rootLabel(out)).toBe(`${escaped} — Pie diagram`);
      expect(root).toBe(
        `<svg role="img" aria-label="${escaped} — Pie diagram" xmlns="http://www.w3.org/2000/svg" width="10">`
      );
      expect(out.endsWith('<g/></svg>')).toBe(true);
    }
  );

  it("render() keeps the root tag whole for a `$'` title", async () => {
    const { svg } = await render("pie Foo$'\nA 1\nB 2");
    expect(rootLabel(svg)).toBe("Foo$' — Pie diagram");
    expect(svg.match(/<svg\b/g)!.length).toBeGreaterThan(0);
    expect(svg.match(/<svg\b[^>]*>/)![0]).not.toMatch(/aria-label="[^"]*xmlns/);
  });
});
