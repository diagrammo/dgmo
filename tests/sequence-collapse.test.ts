// ============================================================
// Collapse Projection Tests
// ============================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseSequenceDgmo } from '../src/sequence/parser';
import type { SequenceNote, SequenceSection } from '../src/sequence/parser';
import { renderSequenceDiagram } from '../src/sequence/renderer';
import type { SequenceRenderOptions } from '../src/sequence/renderer';
import { getPalette } from '../src/palettes';
import { applyCollapseProjection } from '../src/sequence/collapse';

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
        '[Backend] collapse\n  API\n  DB\nUser -request-> API'
      );
      const ids = view.participants.map((p) => p.id);
      expect(ids).toContain('Backend');
      expect(ids).toContain('User');
      expect(ids).not.toContain('API');
      expect(ids).not.toContain('DB');
    });

    it('virtual participant has correct properties', () => {
      const { view } = collapseFixture(
        '[Backend] collapse\n  API\n  DB\nUser -request-> API'
      );
      const vp = view.participants.find((p) => p.id === 'Backend')!;
      expect(vp.label).toBe('Backend');
      expect(vp.type).toBe('default');
    });

    it('remaps message target to group', () => {
      const { view } = collapseFixture(
        '[Backend] collapse\n  API\n  DB\nUser -request-> API'
      );
      expect(view.messages[0].from).toBe('User');
      expect(view.messages[0].to).toBe('Backend');
    });
  });

  describe('internal messages', () => {
    it('internal message becomes self-referential', () => {
      const { view } = collapseFixture(
        '[Backend] collapse\n  API\n  DB\nAPI -query-> DB'
      );
      expect(view.messages[0].from).toBe('Backend');
      expect(view.messages[0].to).toBe('Backend');
    });

    it('internal unlabeled return is suppressed', () => {
      const dgmo = [
        '[Backend] collapse',
        '  API',
        '  DB',
        'User -request-> API',
        'API -query-> DB',
        'DB -> API', // unlabeled return between members
      ].join('\n');
      const { view } = collapseFixture(dgmo);
      // DB -> API (unlabeled return between members) should be suppressed in elements
      const elementMessages = view.elements.filter(
        (el) => !('kind' in el)
      ) as Array<{ from: string; to: string; label: string }>;
      // Only User -> Backend and Backend -> Backend (query) should remain
      expect(elementMessages).toHaveLength(2);
    });

    it('internal labeled message is kept as self-ref', () => {
      const dgmo = [
        '[Backend] collapse',
        '  API',
        '  DB',
        'API -query-> DB',
        'DB -result-> API', // labeled — kept as self-ref
      ].join('\n');
      const { view } = collapseFixture(dgmo);
      const elementMessages = view.elements.filter(
        (el) => !('kind' in el)
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
        '[Backend] collapse',
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
        '[Backend] collapse',
        '  API',
        '  DB',
        'User -request-> API',
        'note right of API',
        '  important detail',
      ].join('\n');
      const { view } = collapseFixture(dgmo);
      const notes = view.elements.filter(
        (el) => 'kind' in el && (el as SequenceNote).kind === 'note'
      ) as SequenceNote[];
      expect(notes.length).toBeGreaterThan(0);
      expect(notes[0].participantId).toBe('Backend');
    });
  });

  describe('mixed collapsed/expanded', () => {
    it('only collapsed group members are replaced', () => {
      const dgmo = [
        '[Backend] collapse',
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
        '[Backend] collapse',
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
        '[Backend] collapse',
        '  API',
        '  DB',
        '[Frontend] collapse',
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
      const dgmo = ['[Backend] collapse', '  API', 'User -request-> API'].join(
        '\n'
      );
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
        '[Backend] collapse',
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
        '[Backend] collapse',
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
        '[Backend] collapse',
        '  API',
        '  DB',
        'User -request-> API',
        '== Phase 2 ==',
        'API -query-> DB',
      ].join('\n');
      const { view } = collapseFixture(dgmo);
      const sections = view.elements.filter(
        (el) => 'kind' in el && (el as SequenceSection).kind === 'section'
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
        '[Backend] collapse',
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
    '[Backend] collapse',
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
      '[Backend] collapse',
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
});
