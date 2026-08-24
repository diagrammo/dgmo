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
import { mix, themeBaseBg } from '../src/palettes/color-utils';
import { COLLAPSE_BAR_HEIGHT } from '../src/utils/visual-conventions';
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

  it('draws no member line inside the box', () => {
    // The members were drawn on a 9px second line until #447. The point of
    // collapsing is to stop caring which members; spending the smallest type
    // on the canvas re-stating them, inside a box that then had to grow to
    // hold them, bought nothing the accessible name below does not.
    const svg = renderToSvg(collapseDiagram)!;
    expect(svg.querySelector('.collapsed-group-members')).toBeNull();
  });

  it('names the swallowed members in the collapsed toggle accessible name', () => {
    // The box shows only "Backend"; the members it has absorbed are drawn
    // nowhere, so the accessible name is the only place a screen reader can
    // learn what collapsing hid.
    const svg = renderToSvg(collapseDiagram)!;
    const participant = svg.querySelector(
      '.participant[data-participant-id="Backend"]'
    )!;
    const label = participant.getAttribute('aria-label')!;
    expect(label).toContain('Backend');
    expect(label).toContain('API');
    expect(label).toContain('DB');
  });

  it('puts no native title tooltip on the collapsed toggle', () => {
    // A native <title> is OS-styled, a second late and absent on touch —
    // banned across every Diagrammo surface. It was also the toggle's whole
    // accessible name ("Click to expand"), which named no group at all.
    const svg = renderToSvg(collapseDiagram)!;
    const participant = svg.querySelector(
      '.participant[data-participant-id="Backend"]'
    )!;
    expect(participant.querySelector('title')).toBeNull();
  });

  it('names a collapsed group in the participant label type, not the header type (#447)', () => {
    // Reverses #242, which had fixed the collapsed name to the expanded
    // header's 11px bold on the argument that collapsing is a reading gesture
    // and the name must not change type under it. It does change kind of
    // object, though: expanded, the name is a strip caption floating above a
    // frame; collapsed, it is the label of a box standing on the participant
    // row. Every other name on that row is LABEL_FONT_SIZE weight 500, and
    // matching the strip made this the only one that was not.
    const expandedDiagram = [
      '[Backend]',
      '  API',
      '  DB',
      'User -request-> API',
    ].join('\n');

    const expanded =
      renderToSvg(expandedDiagram)!.querySelector('.group-label')!;
    const svg = renderToSvg(collapseDiagram)!;
    // The collapsed name is drawn TWICE — renderParticipant's own label, then
    // an overlay rect, then this one on top. The visible one is this one.
    const collapsed = svg.querySelector(
      '.participant[data-participant-id="Backend"] .collapsed-group-label'
    )!;
    // A plain participant's label, for comparison.
    const sibling = svg.querySelector(
      '.participant[data-participant-id="User"] text'
    )!;

    expect(collapsed.textContent).toBe('Backend');
    expect(collapsed.getAttribute('font-size')).toBe(
      sibling.getAttribute('font-size')
    );
    expect(collapsed.getAttribute('font-weight')).toBe(
      sibling.getAttribute('font-weight')
    );
    expect(collapsed.getAttribute('font-size')).not.toBe(
      expanded.getAttribute('font-size')
    );
  });

  it("takes a participant's height when no other group is expanded (#447)", () => {
    // The box was unconditionally H + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM
    // — 80 where a participant is 50 — so a lone collapsed group stood 30px
    // proud of every neighbour and broke the row's shared top edge.
    const svg = renderToSvg(collapseDiagram)!;
    const g = svg.querySelector('.participant[data-participant-id="Backend"]')!;
    // Local coords: y=0 is the participant box top. The overlay is the rect
    // carrying rx=6; the participant's own box underneath is rx=2.
    const overlay = Array.from(g.querySelectorAll('rect')).find(
      (r) => r.getAttribute('rx') === '6'
    )!;
    // The participant's own box is still underneath, drawn at rx=2 by
    // renderRectParticipant — the height to match, without importing it.
    const ownBox = Array.from(g.querySelectorAll('rect')).find(
      (r) => r.getAttribute('rx') === '2'
    )!;
    expect(overlay.getAttribute('y')).toBe('0');
    expect(overlay.getAttribute('height')).toBe(ownBox.getAttribute('height'));
  });

  it('matches the expanded frame when one is on the row (#447)', () => {
    // With something to agree with, the two are the same object drawn two
    // ways, so they line up exactly — top edge and bottom edge.
    const svg = renderToSvg(
      [
        '[Backend] collapsed: true',
        '  API',
        '  DB',
        '[Frontend]',
        '  Web',
        'User -request-> Web',
        'Web -call-> API',
      ].join('\n')
    )!;
    const frame = svg.querySelector('.group-box')!;
    const g = svg.querySelector('.participant[data-participant-id="Backend"]')!;
    const overlay = Array.from(g.querySelectorAll('rect')).find(
      (r) => r.getAttribute('rx') === '6'
    )!;
    // The participant <g> is translated to (cx, participantStartY), so the
    // overlay's local y is the offset from the row's top edge.
    const transform = g.getAttribute('transform')!;
    const participantTop = Number(
      /translate\([^,]+,\s*([-\d.]+)\)/.exec(transform)![1]
    );
    expect(participantTop + Number(overlay.getAttribute('y'))).toBeCloseTo(
      Number(frame.getAttribute('y')),
      5
    );
    expect(overlay.getAttribute('height')).toBe(frame.getAttribute('height'));
  });

  it('draws the collapse bar at the shared height (#447)', () => {
    // COLLAPSE_BAR_HEIGHT lives in utils/visual-conventions.ts and nine other
    // renderers import it. Sequence hardcoded a matching 6, so a deliberate
    // cross-chart change to the constant would have silently skipped it.
    const svg = renderToSvg(collapseDiagram)!;
    const bar = svg.querySelector('.sequence-drill-bar')!;
    expect(Number(bar.getAttribute('height'))).toBe(COLLAPSE_BAR_HEIGHT);
  });

  it('softens the collapse bar on an untagged group (#447)', () => {
    // Everywhere else the bar carries its card's own outline colour. Here the
    // outline falls back to `border` and the bar used to fall back to
    // `textMuted` at full strength — the one place the two disagreed, and the
    // heaviest ink on the canvas. It now sits between them.
    const svg = renderToSvg(collapseDiagram)!;
    const bar = svg.querySelector('.sequence-drill-bar')!;
    const fill = bar.getAttribute('fill')!;
    expect(fill).not.toBe(palette.textMuted);
    expect(fill).toBe(mix(palette.textMuted, themeBaseBg(palette, false), 55));
  });

  it("leaves a tagged group's bar on its own colour (#447)", () => {
    // A tagged group's outline IS the tag colour, so bar and outline already
    // agree and the cross-chart rule is already satisfied. Softening here
    // would break the match it exists to keep.
    const tagged = [
      'tag Area as a',
      '  Storage blue',
      '[Backend] collapsed: true, a: Storage',
      '  API',
      '  DB',
      'User -request-> API',
    ].join('\n');
    const svg = renderToSvg(tagged)!;
    const g = svg.querySelector('.participant[data-participant-id="Backend"]')!;
    const bar = g.querySelector('.sequence-drill-bar')!;
    const overlay = Array.from(g.querySelectorAll('rect')).find(
      (r) => r.getAttribute('rx') === '6'
    )!;
    expect(bar.getAttribute('fill')).toBe(overlay.getAttribute('stroke'));
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

  it('names its members on the expanded toggle, with no native title', () => {
    // Same button, same naming rule as its collapsed twin — the two states
    // disagreeing about what the control is called is what made "Click to
    // collapse" wrong in the first place.
    const expandedDiagram = [
      '[Backend]',
      '  API',
      '  DB',
      'User -request-> API',
    ].join('\n');
    const svg = renderToSvg(expandedDiagram)!;
    const wrapper = svg.querySelector('.group-box-wrapper')!;
    const label = wrapper.getAttribute('aria-label')!;
    expect(label).toContain('Backend');
    expect(label).toContain('API');
    expect(label).toContain('DB');
    expect(wrapper.querySelector('title')).toBeNull();
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
    // firstLine is where the mark's click lands: the first message the
    // participant SENDS. B is addressed on line 1 and speaks on line 2; C is
    // addressed on line 2 and speaks on line 3 (#286).
    expect(summary.get('A')).toEqual({ sends: 1, receives: 0, firstLine: 1 });
    expect(summary.get('B')).toEqual({ sends: 1, receives: 2, firstLine: 2 });
    expect(summary.get('C')).toEqual({ sends: 1, receives: 1, firstLine: 3 });
  });

  // ── Where a mark's click lands (#286) ─────────────────────────────
  //
  // It was the first message that TOUCHED a participant until 2026-08-18,
  // which delivered the participant driving a section to somebody else's
  // message: a cook that sent three orders landed on the line where the
  // quartermaster handed over the keys.

  it('lands on the first message the participant sends, not the first that touches it', () => {
    const messages = [
      msg('Quartermaster', 'Cook', 12),
      msg('Cook', 'Steward', 13),
      msg('Cook', 'Quartermaster', 14),
      msg('Cook', 'Steward', 15),
    ];
    const summary = summarizeSectionParticipation(messages, [0, 1, 2, 3]);
    expect(summary.get('Cook')?.firstLine).toBe(13);
  });

  it('falls back to the first message addressed to a participant that never sends', () => {
    const messages = [
      msg('Quartermaster', 'Cook', 12),
      msg('Cook', 'Steward', 13),
      msg('Cook', 'Steward', 15),
    ];
    const summary = summarizeSectionParticipation(messages, [0, 1, 2]);
    const steward = summary.get('Steward');
    expect(steward?.sends).toBe(0);
    expect(steward?.firstLine).toBe(13);
  });

  it('keeps the sending line even when a later message only addresses it', () => {
    const messages = [msg('A', 'B', 4), msg('B', 'A', 5), msg('A', 'B', 6)];
    const summary = summarizeSectionParticipation(messages, [0, 1, 2]);
    expect(summary.get('A')?.firstLine).toBe(4);
    expect(summary.get('B')?.firstLine).toBe(5);
  });

  it('omits a participant that no message in the run touches', () => {
    const summary = summarizeSectionParticipation([msg('A', 'B', 1)], [0]);
    expect(summary.has('C')).toBe(false);
  });

  it('counts a self-message on both sides, so it never reads as receive-only', () => {
    const summary = summarizeSectionParticipation([msg('A', 'A', 1)], [0]);
    expect(summary.get('A')).toEqual({ sends: 1, receives: 1, firstLine: 1 });
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

  it('gives each involved mark a hit target carrying its first hidden line', () => {
    const svg = renderCollapsed();
    const hit = svg.querySelector(
      '.section-mark-hit[data-participant-id="Ledger"]'
    )!;
    // Ledger is first ADDRESSED on line 4 (`Auth -check funds-> Ledger`) and
    // first SPEAKS on line 5 (`Ledger -balance ok-> Auth`). The click lands on
    // 5: what it said, not what was said to it (#286).
    expect(hit.getAttribute('data-section-mark-line')).toBe('5');
    // The visible mark stays inert; the invisible disc over it takes the click
    expect(markFor(svg, 'Ledger').getAttribute('pointer-events')).toBe('none');
    expect(Number(hit.getAttribute('r'))).toBeGreaterThanOrEqual(9);
  });

  it('carries no data-line-number on the hit target', () => {
    // A child with one resolves to plain line navigation before the click
    // walk-up reaches the band's toggle, so the fold would never open.
    const svg = renderCollapsed();
    for (const hit of svg.querySelectorAll('.section-mark-hit')) {
      expect(hit.getAttribute('data-line-number')).toBeNull();
    }
  });

  it('gives no hit target to a participant the fold never touches', () => {
    // Browser has nothing hidden, so there is nowhere for a click to go.
    const svg = renderCollapsed();
    expect(
      svg.querySelector('.section-mark-hit[data-participant-id="Browser"]')
    ).toBeNull();
    expect(svg.querySelectorAll('.section-mark-hit').length).toBe(4);
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
