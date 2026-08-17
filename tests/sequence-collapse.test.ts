// ============================================================
// Collapse Projection Tests
// ============================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseSequenceDgmo } from '../src/sequence/parser';
import type { SequenceNote, SequenceSection } from '../src/sequence/parser';
import {
  renderSequenceDiagram,
  summarizeSectionParticipation,
} from '../src/sequence/renderer';
import type { SequenceRenderOptions } from '../src/sequence/renderer';
import { getPalette } from '../src/palettes';
import { legendChromeColors } from '../src/utils/legend-constants';
import { applyCollapseProjection } from '../src/sequence/collapse';
import { renderForExport } from '../src/d3';

// Helper to build a parsed diagram and apply collapse
function collapseFixture(dgmo: string, collapsedGroupLines?: number[]) {
  const parsed = parseSequenceDgmo(dgmo);
  expect(parsed.error).toBeNull();
  const collapsedSet = new Set(
    collapsedGroupLines ??
      parsed.groups.filter((g) => g.collapsed).map((g) => g.lineNumber)
  );
  const view = applyCollapseProjection(parsed, collapsedSet);
  return { parsed, view };
}

describe('applyCollapseProjection', () => {
  describe('basic collapse', () => {
    it('replaces group members with virtual group participant', () => {
      const { view } = collapseFixture(
        '[Backend] collapsed: true\n  API\n  DB\nUser -request-> API'
      );
      const ids = view.participants.map((p) => p.id);
      expect(ids).toContain('Backend');
      expect(ids).toContain('User');
      expect(ids).not.toContain('API');
      expect(ids).not.toContain('DB');
    });

    it('virtual participant has correct properties', () => {
      const { view } = collapseFixture(
        '[Backend] collapsed: true\n  API\n  DB\nUser -request-> API'
      );
      const vp = view.participants.find((p) => p.id === 'Backend')!;
      expect(vp.label).toBe('Backend');
      expect(vp.type).toBe('default');
    });

    it('remaps message target to group', () => {
      const { view } = collapseFixture(
        '[Backend] collapsed: true\n  API\n  DB\nUser -request-> API'
      );
      expect(view.messages[0].from).toBe('User');
      expect(view.messages[0].to).toBe('Backend');
    });
  });

  describe('internal messages', () => {
    it('internal message becomes self-referential', () => {
      const { view } = collapseFixture(
        '[Backend] collapsed: true\n  API\n  DB\nAPI -query-> DB'
      );
      expect(view.messages[0].from).toBe('Backend');
      expect(view.messages[0].to).toBe('Backend');
    });

    it('internal unlabeled return is suppressed', () => {
      const dgmo = [
        '[Backend] collapsed: true',
        '  API',
        '  DB',
        'User -request-> API',
        'API -query-> DB',
        'DB -> API', // unlabeled return between members
      ].join('\n');
      const { view } = collapseFixture(dgmo);
      // DB -> API (unlabeled return between members) should be suppressed in elements
      const elementMessages = view.elements.filter(
        (el) => el.kind === 'message'
      ) as Array<{ from: string; to: string; label: string }>;
      // Only User -> Backend and Backend -> Backend (query) should remain
      expect(elementMessages).toHaveLength(2);
    });

    it('internal labeled message is kept as self-ref', () => {
      const dgmo = [
        '[Backend] collapsed: true',
        '  API',
        '  DB',
        'API -query-> DB',
        'DB -result-> API', // labeled — kept as self-ref
      ].join('\n');
      const { view } = collapseFixture(dgmo);
      const elementMessages = view.elements.filter(
        (el) => el.kind === 'message'
      ) as Array<{ from: string; to: string; label: string }>;
      expect(elementMessages).toHaveLength(2);
      expect(elementMessages[1].from).toBe('Backend');
      expect(elementMessages[1].to).toBe('Backend');
      expect(elementMessages[1].label).toBe('result');
    });
  });

  describe('external return preserved', () => {
    it('return from collapsed member to external is remapped, not suppressed', () => {
      const dgmo = [
        '[Backend] collapsed: true',
        '  API',
        '  DB',
        'User -request-> API',
        'API -> User', // unlabeled but external — preserved
      ].join('\n');
      const { view } = collapseFixture(dgmo);
      const ret = view.messages.find(
        (m) => m.to === 'User' && m.from === 'Backend'
      );
      expect(ret).toBeDefined();
    });
  });

  describe('note remapping', () => {
    it('remaps note participant to group', () => {
      const dgmo = [
        '[Backend] collapsed: true',
        '  API',
        '  DB',
        'User -request-> API',
        'note right of API',
        '  important detail',
      ].join('\n');
      const { view } = collapseFixture(dgmo);
      const notes = view.elements.filter(
        (el) => el.kind === 'note'
      ) as SequenceNote[];
      expect(notes.length).toBeGreaterThan(0);
      expect(notes[0].participantId).toBe('Backend');
    });
  });

  describe('mixed collapsed/expanded', () => {
    it('only collapsed group members are replaced', () => {
      const dgmo = [
        '[Backend] collapsed: true',
        '  API',
        '  DB',
        '[Frontend]',
        '  App',
        '  Web',
        'App -request-> API',
      ].join('\n');
      const { view } = collapseFixture(dgmo);
      const ids = view.participants.map((p) => p.id);
      expect(ids).toContain('Backend');
      expect(ids).toContain('App');
      expect(ids).toContain('Web');
      expect(ids).not.toContain('API');
      expect(ids).not.toContain('DB');
    });

    it('expanded group remains in groups list', () => {
      const dgmo = [
        '[Backend] collapsed: true',
        '  API',
        '  DB',
        '[Frontend]',
        '  App',
        'App -request-> API',
      ].join('\n');
      const { view } = collapseFixture(dgmo);
      expect(view.groups).toHaveLength(1);
      expect(view.groups[0].name).toBe('Frontend');
    });
  });

  describe('multiple collapsed groups', () => {
    it('two collapsed groups messaging each other', () => {
      const dgmo = [
        '[Backend] collapsed: true',
        '  API',
        '  DB',
        '[Frontend] collapsed: true',
        '  App',
        '  Web',
        'App -request-> API',
      ].join('\n');
      const { view } = collapseFixture(dgmo);
      expect(view.messages[0].from).toBe('Frontend');
      expect(view.messages[0].to).toBe('Backend');
      expect(view.groups).toHaveLength(0);
    });
  });

  describe('single-member group', () => {
    it('group with one member collapses identically', () => {
      const dgmo = [
        '[Backend] collapsed: true',
        '  API',
        'User -request-> API',
      ].join('\n');
      const { view } = collapseFixture(dgmo);
      const ids = view.participants.map((p) => p.id);
      expect(ids).toContain('Backend');
      expect(ids).not.toContain('API');
      expect(view.messages[0].to).toBe('Backend');
    });
  });

  describe('message ordering invariant', () => {
    it('output message order matches input order', () => {
      const dgmo = [
        '[Backend] collapsed: true',
        '  API',
        '  DB',
        'User -request-> API',
        'User -query-> DB',
        'API -internal-> DB',
      ].join('\n');
      const { parsed, view } = collapseFixture(dgmo);
      expect(view.messages).toHaveLength(parsed.messages.length);
      // All messages map to Backend — verify order preserved
      expect(view.messages[0].label).toBe('request');
      expect(view.messages[1].label).toBe('query');
      expect(view.messages[2].label).toBe('internal');
    });
  });

  describe('immutability', () => {
    it('original ParsedSequenceDgmo is not mutated', () => {
      const dgmo = [
        '[Backend] collapsed: true',
        '  API',
        '  DB',
        'User -request-> API',
        'API -query-> DB',
      ].join('\n');
      const parsed = parseSequenceDgmo(dgmo);
      expect(parsed.error).toBeNull();

      // Snapshot original data
      const origParticipantIds = parsed.participants.map((p) => p.id);
      const origMsgFroms = parsed.messages.map((m) => m.from);
      const origGroupCount = parsed.groups.length;

      // Apply projection
      const collapsedSet = new Set(parsed.groups.map((g) => g.lineNumber));
      applyCollapseProjection(parsed, collapsedSet);

      // Verify no mutation
      expect(parsed.participants.map((p) => p.id)).toEqual(origParticipantIds);
      expect(parsed.messages.map((m) => m.from)).toEqual(origMsgFroms);
      expect(parsed.groups).toHaveLength(origGroupCount);
    });
  });

  describe('sections pass through unchanged', () => {
    it('section dividers are not corrupted by remapping', () => {
      const dgmo = [
        '[Backend] collapsed: true',
        '  API',
        '  DB',
        'User -request-> API',
        '== Phase 2 ==',
        'API -query-> DB',
      ].join('\n');
      const { view } = collapseFixture(dgmo);
      const sections = view.elements.filter(
        (el) => el.kind === 'section'
      ) as SequenceSection[];
      expect(sections).toHaveLength(1);
      expect(sections[0].label).toBe('Phase 2');
      // Ensure section doesn't have extraneous from/to properties
      expect('from' in sections[0]).toBe(false);
      expect('to' in sections[0]).toBe(false);
    });
  });

  describe('name collision handling', () => {
    it('participant with same name as collapsed group is absorbed', () => {
      const dgmo = [
        '[Backend] collapsed: true',
        '  API',
        '  DB',
        'Backend -request-> API',
      ].join('\n');
      const { view } = collapseFixture(dgmo);
      const ids = view.participants.map((p) => p.id);
      // Should not have duplicate Backend entries
      expect(ids.filter((id) => id === 'Backend')).toHaveLength(1);
    });
  });

  describe('empty collapsed set', () => {
    it('returns original data when no groups collapsed', () => {
      const dgmo = '[Backend]\n  API\n  DB\nUser -request-> API';
      const parsed = parseSequenceDgmo(dgmo);
      expect(parsed.error).toBeNull();
      const view = applyCollapseProjection(parsed, new Set());
      expect(view.participants).toBe(parsed.participants);
      expect(view.messages).toBe(parsed.messages);
      expect(view.groups).toBe(parsed.groups);
    });
  });
});

// ============================================================
// Collapse Rendering Tests (SVG DOM)
// ============================================================

let doc: Document;
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  doc = win.document;
  Object.defineProperty(globalThis, 'document', {
    value: doc,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: win.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    value: win.SVGElement,
    configurable: true,
  });
});

const palette = getPalette('nord').light;

function renderToSvg(
  input: string,
  options?: SequenceRenderOptions
): SVGSVGElement | null {
  const parsed = parseSequenceDgmo(input);
  expect(parsed.error).toBeNull();
  const container = doc.createElement('div') as unknown as HTMLDivElement;
  doc.body.appendChild(container);
  renderSequenceDiagram(container, parsed, palette, false, undefined, {
    exportWidth: 800,
    ...options,
  });
  const svg = container.querySelector('svg');
  doc.body.removeChild(container);
  return svg;
}

describe('Collapse rendering', () => {
  const collapseDiagram = [
    '[Backend] collapsed: true',
    '  API',
    '  DB',
    'User -request-> API',
    'API -query-> DB',
  ].join('\n');

  it('collapsed group has no .group-box element', () => {
    const svg = renderToSvg(collapseDiagram)!;
    const groupBoxes = svg.querySelectorAll('.group-box');
    expect(groupBoxes).toHaveLength(0);
  });

  it('virtual participant has .participant with group name', () => {
    const svg = renderToSvg(collapseDiagram)!;
    const participants = svg.querySelectorAll('.participant');
    const ids = Array.from(participants).map((p) =>
      p.getAttribute('data-participant-id')
    );
    expect(ids).toContain('Backend');
    expect(ids).not.toContain('API');
    expect(ids).not.toContain('DB');
  });

  it('drill-bar is present on collapsed group participant', () => {
    const svg = renderToSvg(collapseDiagram)!;
    const drillBars = svg.querySelectorAll('.sequence-drill-bar');
    expect(drillBars.length).toBeGreaterThan(0);
    // data-group-toggle is on the participant <g> wrapper
    const participant = svg.querySelector(
      '.participant[data-participant-id="Backend"]'
    )!;
    expect(participant.getAttribute('data-group-toggle')).toBe('');
  });

  it('draws the group name in the same type collapsed as expanded (#242)', () => {
    // Collapsing is a reading gesture — same diagram, less in it. The name
    // changing weight or size under it reads as a different kind of object
    // appearing. Colour and opacity may differ; type may not.
    const expandedDiagram = [
      '[Backend]',
      '  API',
      '  DB',
      'User -request-> API',
    ].join('\n');

    const expanded =
      renderToSvg(expandedDiagram)!.querySelector('.group-label')!;
    // The collapsed name is drawn TWICE — renderParticipant's own label, then
    // an overlay rect, then this one on top. The visible one is this one.
    const collapsed = renderToSvg(collapseDiagram)!.querySelector(
      '.participant[data-participant-id="Backend"] .collapsed-group-label'
    )!;

    expect(expanded.textContent).toBe('Backend');
    expect(collapsed.textContent).toBe('Backend');
    expect(collapsed.getAttribute('font-size')).toBe(
      expanded.getAttribute('font-size')
    );
    expect(collapsed.getAttribute('font-weight')).toBe(
      expanded.getAttribute('font-weight')
    );
    // Only Inter Regular and Inter Bold ship, so a numeric weight below 700
    // resolves down to Regular — a full weight step, not a nudge.
    expect(collapsed.getAttribute('font-weight')).toBe('bold');
  });

  it('expanded group has .group-box present', () => {
    const expandedDiagram = [
      '[Backend]',
      '  API',
      '  DB',
      'User -request-> API',
    ].join('\n');
    const svg = renderToSvg(expandedDiagram)!;
    const groupBoxes = svg.querySelectorAll('.group-box');
    expect(groupBoxes.length).toBeGreaterThan(0);
  });

  it('messages render from/to virtual participant', () => {
    const svg = renderToSvg(collapseDiagram)!;
    // User participant should exist
    const participants = svg.querySelectorAll('.participant');
    const ids = Array.from(participants).map((p) =>
      p.getAttribute('data-participant-id')
    );
    expect(ids).toContain('User');
    expect(ids).toContain('Backend');
    // Should have 2 participants total
    expect(ids).toHaveLength(2);
  });

  it('mixed collapsed and expanded groups render correctly', () => {
    const mixedDiagram = [
      '[Backend] collapsed: true',
      '  API',
      '  DB',
      '[Frontend]',
      '  App',
      '  Web',
      'App -request-> API',
    ].join('\n');
    const svg = renderToSvg(mixedDiagram)!;
    const participants = svg.querySelectorAll('.participant');
    const ids = Array.from(participants).map((p) =>
      p.getAttribute('data-participant-id')
    );
    expect(ids).toContain('Backend');
    expect(ids).toContain('App');
    expect(ids).toContain('Web');
    expect(ids).not.toContain('API');
    expect(ids).not.toContain('DB');
    // Frontend group box should exist
    const groupBoxes = svg.querySelectorAll('.group-box');
    expect(groupBoxes.length).toBeGreaterThan(0);
  });

  it('runtime collapsedGroups option collapses a group', () => {
    const diagram = ['[Backend]', '  API', '  DB', 'User -request-> API'].join(
      '\n'
    );
    const parsed = parseSequenceDgmo(diagram);
    expect(parsed.error).toBeNull();
    const groupLine = parsed.groups[0].lineNumber;
    const svg = renderToSvg(diagram, {
      collapsedGroups: new Set([groupLine]),
    })!;
    const participants = svg.querySelectorAll('.participant');
    const ids = Array.from(participants).map((p) =>
      p.getAttribute('data-participant-id')
    );
    expect(ids).toContain('Backend');
    expect(ids).not.toContain('API');
  });

  it('expanded group exposes a header hit area + centered label', () => {
    const expandedDiagram = [
      '[Backend]',
      '  API',
      '  DB',
      'User -request-> API',
    ].join('\n');
    const svg = renderToSvg(expandedDiagram)!;
    // Toggle wrapper carries the group line + a11y role
    const wrapper = svg.querySelector('.group-box-wrapper')!;
    expect(wrapper.getAttribute('data-group-toggle')).toBe('');
    expect(wrapper.getAttribute('role')).toBe('button');
    expect(wrapper.getAttribute('aria-expanded')).toBe('true');
    // Generous, non-occluded click target over the header strip
    expect(svg.querySelector('.group-label-hit')).not.toBeNull();
    // Visible frame must not steal clicks (it sits behind the participants)
    expect(
      svg.querySelector('.group-box')!.getAttribute('pointer-events')
    ).toBe('none');
    // Label is centered across the header strip (no chevron affordance)
    expect(svg.querySelector('.group-chevron')).toBeNull();
    expect(svg.querySelector('.group-label')!.getAttribute('text-anchor')).toBe(
      'middle'
    );
  });

  it('section collapse hides messages even when a group is also collapsed', () => {
    // Regression: collapse projection creates spread copies of message objects
    // for messages[] and elements[], breaking reference equality in
    // groupMessagesBySection. Section collapse must use lineNumber lookup
    // so its messageIndices populate correctly even on a projected view.
    const diagram = [
      '[Backend]',
      '  API',
      '  DB',
      '== Setup ==',
      'User -req-> API',
      'API -query-> DB',
    ].join('\n');
    const parsed = parseSequenceDgmo(diagram);
    expect(parsed.error).toBeNull();
    const groupLine = parsed.groups[0].lineNumber;
    const sectionLine = parsed.elements
      .filter((el): el is SequenceSection => el.kind === 'section')
      .map((s) => s.lineNumber)[0];

    const svg = renderToSvg(diagram, {
      collapsedGroups: new Set([groupLine]),
      collapsedSections: new Set([sectionLine]),
    })!;
    // No message arrows should be rendered inside the collapsed section
    const arrows = svg.querySelectorAll('.message-arrow');
    expect(arrows.length).toBe(0);
  });
});

describe('collapse keyword', () => {
  it('"collapsed: true" metadata does not emit warning', () => {
    const parsed = parseSequenceDgmo(
      '[Backend] collapsed: true\n  API\n  DB\nUser -> API'
    );
    expect(parsed.groups[0].collapsed).toBe(true);
    expect(
      parsed.diagnostics.some((d) => d.message.includes('deprecated'))
    ).toBe(false);
  });
});

describe('renderForExport applies sequence share-link viewState', () => {
  const diagram = [
    '[Backend]',
    '  API',
    '  DB',
    '== Setup ==',
    'User -request-> API',
    'API -query-> DB',
  ].join('\n');

  const countParticipants = (svg: string) =>
    (svg.match(/class="participant"/g) ?? []).length;

  it('collapses a group from viewState.cg (group line numbers as strings)', async () => {
    const parsed = parseSequenceDgmo(diagram);
    const groupLine = parsed.groups[0].lineNumber;
    const base = await renderForExport(diagram, 'light', palette, undefined, {
      exportMode: true,
    });
    const collapsed = await renderForExport(
      diagram,
      'light',
      palette,
      { cg: [String(groupLine)] },
      { exportMode: true }
    );
    // Backend's two members (API, DB) collapse into one virtual participant
    expect(countParticipants(collapsed)).toBe(countParticipants(base) - 1);
    expect(collapsed).toContain('data-participant-id="Backend"');
    expect(collapsed).not.toContain('data-participant-id="API"');
  });

  it('collapses a section from viewState.cs (section line numbers)', async () => {
    const parsed = parseSequenceDgmo(diagram);
    const sectionLine = parsed.elements
      .filter((el): el is SequenceSection => el.kind === 'section')
      .map((s) => s.lineNumber)[0];
    const collapsed = await renderForExport(
      diagram,
      'light',
      palette,
      { cs: [sectionLine] },
      { exportMode: true }
    );
    // Messages inside the collapsed section are suppressed
    expect(collapsed).not.toContain('class="message-arrow"');
  });

  it('ignores malformed viewState.cg entries without throwing', async () => {
    const out = await renderForExport(
      diagram,
      'light',
      palette,
      { cg: ['not-a-number'] },
      { exportMode: true }
    );
    // Non-numeric entries are filtered → nothing collapses, render still succeeds
    expect(out).toContain('data-participant-id="API"');
  });
});

// ============================================================
// Collapsed Section Participant Marks
// ============================================================

describe('summarizeSectionParticipation', () => {
  const msg = (from: string, to: string, lineNumber: number) => ({
    kind: 'message' as const,
    from,
    to,
    label: '',
    lineNumber,
  });

  it('counts sends and receives separately', () => {
    const messages = [msg('A', 'B', 1), msg('B', 'C', 2), msg('C', 'B', 3)];
    const summary = summarizeSectionParticipation(messages, [0, 1, 2]);
    expect(summary.get('A')).toEqual({ sends: 1, receives: 0 });
    expect(summary.get('B')).toEqual({ sends: 1, receives: 2 });
    expect(summary.get('C')).toEqual({ sends: 1, receives: 1 });
  });

  it('omits a participant that no message in the run touches', () => {
    const summary = summarizeSectionParticipation([msg('A', 'B', 1)], [0]);
    expect(summary.has('C')).toBe(false);
  });

  it('counts a self-message on both sides, so it never reads as receive-only', () => {
    const summary = summarizeSectionParticipation([msg('A', 'A', 1)], [0]);
    expect(summary.get('A')).toEqual({ sends: 1, receives: 1 });
  });

  it('ignores indices that address no message', () => {
    const summary = summarizeSectionParticipation([msg('A', 'B', 1)], [0, 9]);
    expect(summary.size).toBe(2);
  });
});

describe('collapsed section participant marks', () => {
  // Gateway sends and receives, Auth does both three times over, Ledger does
  // one of each, Notifier only ever receives, and Browser is not in the fold.
  const diagram = [
    'Browser -place order-> Gateway',
    '== Fraud screening ==',
    'Gateway -verify token-> Auth',
    'Auth -check funds-> Ledger',
    'Ledger -balance ok-> Auth',
    'Auth -log decision-> Notifier',
    'Auth -cleared-> Gateway',
  ].join('\n');

  const sectionLineOf = (input: string): number =>
    parseSequenceDgmo(input)
      .elements.filter((el): el is SequenceSection => el.kind === 'section')
      .map((s) => s.lineNumber)[0]!;

  const renderCollapsed = (input = diagram): SVGSVGElement =>
    renderToSvg(input, {
      collapsedSections: new Set([sectionLineOf(input)]),
    })!;

  const markFor = (svg: SVGSVGElement, id: string): SVGElement =>
    svg.querySelector(`.section-mark[data-participant-id="${id}"]`)!;

  it('draws one mark per participant, involved or not', () => {
    const svg = renderCollapsed();
    expect(svg.querySelectorAll('.section-mark').length).toBe(5);
  });

  it('fills the mark of a participant that sends', () => {
    const svg = renderCollapsed();
    expect(markFor(svg, 'Gateway').classList).toContain('section-mark-sends');
    expect(markFor(svg, 'Gateway').getAttribute('fill')).not.toBe('none');
  });

  it('draws a ring for a participant that only ever receives', () => {
    const svg = renderCollapsed();
    const notifier = markFor(svg, 'Notifier');
    expect(notifier.classList).toContain('section-mark-receives');
    // Hollow against the band, outlined in the participant's own colour
    const bandFill = svg
      .querySelector('.section-divider')!
      .getAttribute('fill');
    expect(notifier.getAttribute('fill')).toBe(bandFill);
    expect(notifier.getAttribute('stroke')).toBe(palette.text);
  });

  it('wears the legend background rather than a heavier tint', () => {
    const band = renderCollapsed().querySelector('.section-divider')!;
    const { groupBg } = legendChromeColors(palette, false);
    expect(band.getAttribute('fill')).toBe(groupBg);
    expect(band.getAttribute('opacity')).toBe('1');
  });

  it('leaves an expanded band as the faint tint it has always been', () => {
    const band = renderToSvg(diagram)!.querySelector('.section-divider')!;
    expect(band.getAttribute('fill')).toBe(palette.textMuted);
    expect(Number(band.getAttribute('opacity'))).toBeLessThan(0.2);
  });

  it('draws the absent tick for a participant the fold never touches', () => {
    const svg = renderCollapsed();
    const browser = markFor(svg, 'Browser');
    expect(browser.classList).toContain('section-mark-absent');
    expect(browser.getAttribute('fill')).toBe('none');
  });

  it('sizes the mark by how many messages touch the participant', () => {
    const svg = renderCollapsed();
    const r = (id: string) => Number(markFor(svg, id).getAttribute('r'));
    // Auth is in all five; Gateway and Ledger in two each
    expect(r('Auth')).toBeGreaterThan(r('Gateway'));
    expect(r('Gateway')).toBe(r('Ledger'));
  });

  it('takes the mark colour from the participant tag, not the band', () => {
    const tagged = [
      'tag Zone as t',
      '  Edge blue',
      '  Core green',
      'Gateway t: Edge',
      'Auth t: Core',
      'Browser -place order-> Gateway',
      '== Fraud screening ==',
      'Gateway -verify token-> Auth',
      'Auth -cleared-> Gateway',
    ].join('\n');
    const svg = renderCollapsed(tagged);
    const gateway = markFor(svg, 'Gateway').getAttribute('fill');
    const auth = markFor(svg, 'Auth').getAttribute('fill');
    expect(gateway).toBeTruthy();
    expect(gateway).not.toBe(auth);
    // …and it matches the colour that participant's own lifeline wears
    const lifeline = svg.querySelector(
      'line.lifeline[data-participant-id="Gateway"]'
    )!;
    expect(lifeline.getAttribute('stroke')).toBe(gateway);
  });

  it('spans a reach hairline across the columns the fold touches', () => {
    const svg = renderCollapsed();
    const reach = svg.querySelector('.section-reach')!;
    const x1 = Number(reach.getAttribute('x1'));
    const x2 = Number(reach.getAttribute('x2'));
    const browserX = Number(markFor(svg, 'Browser').getAttribute('cx'));
    // Browser is outside the fold, so the reach must stop short of its column
    expect(x2).toBeGreaterThan(x1);
    expect(x1).toBeGreaterThan(browserX);
  });

  it('names the involved participants in the band accessible name', () => {
    const svg = renderCollapsed();
    const band = svg.querySelector('[data-section-toggle]')!;
    const label = band.getAttribute('aria-label')!;
    expect(label).toContain('Fraud screening (5 messages)');
    expect(label).toContain('Auth');
    expect(label).not.toContain('Browser');
  });

  it('draws no marks and keeps the short band while expanded', () => {
    const svg = renderToSvg(diagram)!;
    expect(svg.querySelectorAll('.section-mark').length).toBe(0);
    expect(svg.querySelector('.section-divider')!.getAttribute('height')).toBe(
      '22'
    );
  });

  it('grows the band to make room for the mark row', () => {
    const svg = renderCollapsed();
    expect(svg.querySelector('.section-divider')!.getAttribute('height')).toBe(
      '36'
    );
  });

  it('keeps the centred label on its own row above the marks', () => {
    const svg = renderCollapsed();
    const label = svg.querySelector('.section-label')!;
    expect(label.getAttribute('text-anchor')).toBe('middle');
    const labelY = Number(label.getAttribute('y'));
    const markY = Number(markFor(svg, 'Auth').getAttribute('cy'));
    expect(markY).toBeGreaterThan(labelY);
  });

  it('cuts the lifelines that would run behind the label', () => {
    const svg = renderCollapsed();
    const label = svg.querySelector('.section-label')!;
    const labelX = Number(label.getAttribute('x'));
    const labelY = Number(label.getAttribute('y'));
    // Whichever participant's column the centred label crosses
    const crossed = [...svg.querySelectorAll('.section-mark')]
      .map((m) => Number(m.getAttribute('cx')))
      .reduce((best, cx) =>
        Math.abs(cx - labelX) < Math.abs(best - labelX) ? cx : best
      );
    const spans = [
      ...svg.querySelectorAll<SVGLineElement>('line.lifeline'),
    ].filter((l) => Number(l.getAttribute('x1')) === crossed);
    // That lifeline is drawn in two runs with the label's row missing between
    expect(spans.length).toBe(2);
    const gapTop = Number(spans[0]!.getAttribute('y2'));
    const gapBottom = Number(spans[1]!.getAttribute('y1'));
    expect(gapTop).toBeLessThan(labelY);
    expect(gapBottom).toBeGreaterThan(labelY - 12);
    expect(gapBottom).toBeGreaterThan(gapTop);
  });

  it('cuts an expanded section label out of the lifelines too', () => {
    const svg = renderToSvg(diagram)!;
    const labelX = Number(
      svg.querySelector('.section-label')!.getAttribute('x')
    );
    const lifelines = [
      ...svg.querySelectorAll<SVGLineElement>('line.lifeline'),
    ];
    const nearest = lifelines
      .map((l) => Number(l.getAttribute('x1')))
      .reduce((best, x) =>
        Math.abs(x - labelX) < Math.abs(best - labelX) ? x : best
      );
    expect(
      lifelines.filter((l) => Number(l.getAttribute('x1')) === nearest).length
    ).toBe(2);
  });

  it('leaves a lifeline whole when no label crosses its column', () => {
    const svg = renderCollapsed();
    const browserX = Number(markFor(svg, 'Browser').getAttribute('cx'));
    const spans = [
      ...svg.querySelectorAll<SVGLineElement>('line.lifeline'),
    ].filter((l) => Number(l.getAttribute('x1')) === browserX);
    expect(spans.length).toBe(1);
  });

  it('marks the group lifeline when a collapsed group hides the sender', () => {
    const grouped = [
      '[Backend]',
      '  Auth',
      '  Ledger',
      'Browser -place order-> Gateway',
      '== Fraud screening ==',
      'Gateway -verify token-> Auth',
      'Auth -check funds-> Ledger',
    ].join('\n');
    const parsed = parseSequenceDgmo(grouped);
    const svg = renderToSvg(grouped, {
      collapsedGroups: new Set([parsed.groups[0]!.lineNumber]),
      collapsedSections: new Set([sectionLineOf(grouped)]),
    })!;
    // The members are gone from the canvas; the mark lands on the group
    expect(markFor(svg, 'Backend')).toBeTruthy();
    expect(markFor(svg, 'Backend').classList).toContain('section-mark-sends');
    expect(svg.querySelector('.section-mark[data-participant-id="Auth"]')).toBe(
      null
    );
  });
});
