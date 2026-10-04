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
