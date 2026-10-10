/**
 * A tag group whose name has a space (`tag Ended in as o`) must key its
 * metadata by the slug `tagAttrKey` makes (`ended-in`), never by the raw
 * lower-cased name. The raw name became `data-tag-ended in`, which is not a
 * valid attribute name, so rendering threw (tracker #1085).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { getPalette } from '../src/palettes';
import { parseVisualization, renderTimeline } from '../src/d3';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { renderSequenceDiagram } from '../src/sequence/renderer';
import { parseERDiagram } from '../src/er/parser';
import { layoutERDiagram } from '../src/er/layout';
import { renderERDiagram } from '../src/er/renderer';
import { parseKanban } from '../src/kanban/parser';
import { renderKanban } from '../src/kanban/renderer';
import { parseC4 } from '../src/c4/parser';
import { layoutC4Context } from '../src/c4/layout';
import { renderC4Context } from '../src/c4/renderer';

let doc: Document;
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  doc = win.document;
  for (const [key, value] of Object.entries({
    document: doc,
    window: win,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
  })) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
});

const palette = getPalette('nord').light;

describe('multi-word tag group names', () => {
  it('timeline renders data-tag-ended-in', () => {
    const src = [
      'timeline T',
      'tag Ended in as o',
      '  Done green',
      '[Lane A]',
      '  2026-10-03 21:00 -> 2026-10-03 21:30 #1 x o: Done',
    ].join('\n');
    const parsed = parseVisualization(src, palette);
    expect(parsed.error).toBeFalsy();
    const container = doc.createElement('div') as unknown as HTMLDivElement;
    doc.body.appendChild(container);
    expect(() =>
      renderTimeline(container, parsed, palette, false, undefined, {
        width: 1200,
        height: 600,
      })
    ).not.toThrow();
    expect(
      container.querySelector('[data-tag-ended-in="done"]')
    ).not.toBeNull();
    doc.body.removeChild(container);
  });

  it('timeline lanes by a multi-word tag group', () => {
    const src = [
      'timeline T',
      'tag Ended in as o',
      '  Done green',
      '  Open red',
      '[Lane A]',
      '  2026-10-03 21:00 -> 2026-10-03 21:30 first o: Done',
      '  2026-10-03 22:00 -> 2026-10-03 22:30 second o: Open',
    ].join('\n');
    const parsed = parseVisualization(src, palette);
    expect(parsed.error).toBeFalsy();
    const container = doc.createElement('div') as unknown as HTMLDivElement;
    doc.body.appendChild(container);
    renderTimeline(
      container,
      parsed,
      palette,
      false,
      undefined,
      { width: 1200, height: 600 },
      null,
      'Ended in'
    );
    const lanes = [...container.querySelectorAll('.tl-group-header')].map(
      (el) => el.getAttribute('data-group')
    );
    expect(lanes).toEqual(['Done', 'Open']);
    doc.body.removeChild(container);
  });

  it('sequence renders data-tag-ended-in', () => {
    const src = [
      'sequence',
      '',
      'tag Ended in as o',
      '  Done green',
      '  Open red',
      '',
      'A -hi-> B | o: Open',
    ].join('\n');
    const parsed = parseSequenceDgmo(src);
    expect(parsed.error).toBeNull();
    const container = doc.createElement('div') as unknown as HTMLDivElement;
    doc.body.appendChild(container);
    expect(() =>
      renderSequenceDiagram(container, parsed, palette, false, undefined, {
        exportWidth: 800,
      })
    ).not.toThrow();
    expect(
      container.querySelector('[data-tag-ended-in="open"]')
    ).not.toBeNull();
    doc.body.removeChild(container);
  });

  it('er renders data-tag-ended-in', () => {
    const src = [
      'er',
      '',
      'tag Ended in as o',
      '  Done green',
      '  Open red',
      '',
      'users o: Open',
      '  id int pk',
    ].join('\n');
    const parsed = parseERDiagram(src, palette);
    expect(parsed.error).toBeNull();
    const container = doc.createElement('div') as unknown as HTMLDivElement;
    doc.body.appendChild(container);
    renderERDiagram(
      container,
      parsed,
      layoutERDiagram(parsed),
      palette,
      false,
      undefined,
      { width: 1200, height: 800 },
      'Ended in'
    );
    expect(
      container.querySelector('[data-tag-ended-in="open"]')
    ).not.toBeNull();
    doc.body.removeChild(container);
  });

  it('kanban gives an untagged card the default of a multi-word group', () => {
    const src = [
      'kanban',
      '',
      'tag Ended in as o',
      '  Done green',
      '  Open red',
      '',
      '[To Do]',
      '  Fix login bug',
    ].join('\n');
    const parsed = parseKanban(src, palette);
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    renderKanban(container, parsed, palette, false, {
      activeTagGroup: 'Ended in',
    });
    expect(
      container.querySelector('[data-tag-ended-in="done"]')
    ).not.toBeNull();
    doc.body.removeChild(container);
  });

  it('c4 gives an untagged element the default of a multi-word group', () => {
    const src = [
      'c4',
      'tag Ended in as o',
      '  Done green',
      '  Open red',
      '',
      'Alice is a person',
    ].join('\n');
    const parsed = parseC4(src, palette);
    const container = doc.createElement('div') as unknown as HTMLDivElement;
    doc.body.appendChild(container);
    renderC4Context(
      container,
      parsed,
      layoutC4Context(parsed),
      palette,
      false,
      undefined,
      { width: 1200, height: 800 },
      'Ended in'
    );
    expect(
      container.querySelector('[data-tag-ended-in="done"]')
    ).not.toBeNull();
    doc.body.removeChild(container);
  });
});
