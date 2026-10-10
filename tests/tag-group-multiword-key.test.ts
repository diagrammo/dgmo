/**
 * A tag group whose name has a space (`tag Ended in as o`) must key its
 * metadata by the slug `tagAttrKey` makes (`ended-in`), never by the raw
 * lower-cased name. The raw name became `data-tag-ended in`, which is not a
 * valid attribute name, so rendering threw (tracker #1085).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { getPalette } from '../src/palettes';
import { parseVisualization, renderTimeline, renderForExport } from '../src/d3';
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
import { parseMindmap } from '../src/mindmap/parser';
import { layoutMindmap } from '../src/mindmap/layout';
import { renderMindmap } from '../src/mindmap/renderer';
import { parseJourneyMap } from '../src/journey-map/parser';
import { renderJourneyMap } from '../src/journey-map/renderer';

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

  it('timeline swimlane toggle starts pressed and turns off on one click', () => {
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
    const container = doc.createElement('div') as unknown as HTMLDivElement;
    Object.defineProperty(container, 'clientWidth', { value: 1200 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });
    doc.body.appendChild(container);
    const changes: (string | null)[] = [];
    renderTimeline(
      container,
      parsed,
      palette,
      false,
      undefined,
      undefined,
      'Ended in',
      'Ended in',
      (_active, swimlane) => changes.push(swimlane)
    );
    const toggle = container.querySelector('[data-swimlane-toggle="ended-in"]');
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    toggle!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(changes).toEqual([null]);
    doc.body.removeChild(container);
  });

  it('mindmap legend keeps a multi-word group and its used entries', () => {
    const src = [
      'mindmap M',
      '',
      'tag Ended in as o',
      '  Done green',
      '  Open red',
      '  Extra blue',
      '',
      'Root o: Done',
      '  Child o: Open',
    ].join('\n');
    const parsed = parseMindmap(src, palette);
    const container = doc.createElement('div') as unknown as HTMLDivElement;
    Object.defineProperty(container, 'clientWidth', { value: 1200 });
    Object.defineProperty(container, 'clientHeight', { value: 800 });
    doc.body.appendChild(container);
    renderMindmap(
      container,
      parsed,
      layoutMindmap(parsed, palette),
      palette,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      'Ended in'
    );
    const entries = [...container.querySelectorAll('[data-legend-entry]')].map(
      (el) => el.getAttribute('data-legend-entry')
    );
    expect(entries.sort()).toEqual(['done', 'open']);
    doc.body.removeChild(container);
  });

  it('gantt legend lists only the values a multi-word group uses', async () => {
    const src = [
      'gantt G',
      'start-date 2024-01-15',
      '',
      'tag Ended in as o',
      '  Done green',
      '  Open red',
      '  Extra blue',
      '',
      '+5bd Task one 5bd o: Done',
      '+5bd Task two 5bd o: Done',
    ].join('\n');
    const svg = await renderForExport(src, 'light', palette, undefined, {
      exportMode: true,
      tagGroup: 'Ended in',
    });
    const entries = [...svg.matchAll(/data-legend-entry="([^"]*)"/g)].map(
      (m) => m[1]
    );
    expect(entries).toEqual(['done']);
  });

  it('kanban and journey-map suggest a value for a multi-word group', () => {
    const kanban = parseKanban(
      [
        'kanban',
        '',
        'tag Ended in as o',
        '  Done green',
        '  Open red',
        '',
        '[To Do]',
        '  Card one | o: Dnoe',
      ].join('\n'),
      palette
    );
    expect(kanban.diagnostics.map((d) => d.message).join('\n')).toContain(
      "Did you mean 'Done'?"
    );
    const journey = parseJourneyMap(
      [
        'journey-map J',
        '',
        'tag Ended in as o',
        '  Done green',
        '  Open red',
        '',
        '[Phase]',
        '  Step score: 3, o: Dnoe',
      ].join('\n'),
      palette
    );
    expect(journey.diagnostics.map((d) => d.message).join('\n')).toContain(
      "Did you mean 'Done'?"
    );
  });

  it('journey-map colours a step strip by a multi-word group', () => {
    const fills = (name: string) => {
      const parsed = parseJourneyMap(
        [
          'journey-map J',
          '',
          `tag ${name} as o`,
          '  Done green',
          '  Open red',
          '',
          '[Phase]',
          '  Step score: 3, o: Open',
        ].join('\n'),
        palette
      );
      const container = doc.createElement('div') as unknown as HTMLDivElement;
      Object.defineProperty(container, 'clientWidth', { value: 1200 });
      Object.defineProperty(container, 'clientHeight', { value: 800 });
      doc.body.appendChild(container);
      renderJourneyMap(container, parsed, palette, false);
      const out = [...container.querySelectorAll('rect')].map((r) =>
        r.getAttribute('fill')
      );
      doc.body.removeChild(container);
      return out;
    };
    expect(fills('Ended in')).toEqual(fills('Status'));
  });

  it('timeline view mode shows the legend of a multi-word colour group', () => {
    const src = [
      'timeline T',
      'tag Ended in as o',
      '  Done green',
      '  Open red',
      '[Lane A]',
      '  2026-10-03 21:00 -> 2026-10-03 21:30 first o: Done',
    ].join('\n');
    const parsed = parseVisualization(src, palette);
    const container = doc.createElement('div') as unknown as HTMLDivElement;
    Object.defineProperty(container, 'clientWidth', { value: 1200 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });
    doc.body.appendChild(container);
    renderTimeline(
      container,
      parsed,
      palette,
      false,
      undefined,
      undefined,
      'Ended in',
      null,
      undefined,
      true
    );
    expect(
      container.querySelector('[data-legend-entry="done"]')
    ).not.toBeNull();
    doc.body.removeChild(container);
  });

  it('timeline view mode keeps the legend for a swimlane given as its slug', () => {
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
    const container = doc.createElement('div') as unknown as HTMLDivElement;
    Object.defineProperty(container, 'clientWidth', { value: 1200 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });
    doc.body.appendChild(container);
    renderTimeline(
      container,
      parsed,
      palette,
      false,
      undefined,
      undefined,
      null,
      'ended-in',
      undefined,
      true
    );
    expect(container.querySelectorAll('[data-legend-entry]').length).toBe(2);
    doc.body.removeChild(container);
  });
});
