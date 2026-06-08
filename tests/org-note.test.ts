import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseOrg } from '../src/org/parser';
import { layoutOrg } from '../src/org/layout';
import { renderOrgForExport } from '../src/org/renderer';
import { resolveNotes } from '../src/utils/notes';
import { getPalette } from '../src/palettes';

let parseSvg: (s: string) => Document;
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const [k, v] of Object.entries({
    document: win.document,
    window: win,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
  })) {
    Object.defineProperty(globalThis, k, { value: v, configurable: true });
  }
  parseSvg = (s: string) =>
    new win.DOMParser().parseFromString(s, 'image/svg+xml');
});

const P = getPalette('nord').light;
const org = (src: string) => renderOrgForExport(src, 'light', P);

const errors = (d: readonly { severity: string }[]) =>
  d.filter((x) => x.severity === 'error');

const flat = (p: ReturnType<typeof parseOrg>) => {
  const out: { id: string; label: string }[] = [];
  const walk = (
    ns: readonly { id: string; label: string; children: readonly any[] }[]
  ) => {
    for (const n of ns) {
      out.push({ id: n.id, label: n.label });
      walk(n.children);
    }
  };
  walk(p.roots as any);
  return out;
};

const SRC = [
  'org',
  'Blackbeard',
  '  Silver',
  '  Flint',
  'note Blackbeard commands the fleet',
].join('\n');

describe('org notes — parsing', () => {
  it('collects a note and resolves it to a node', () => {
    const parsed = parseOrg(SRC, P);
    expect(parsed.error).toBeNull();
    expect(parsed.notes?.length).toBe(1);
    expect(parsed.notes![0]!.ref).toBe('Blackbeard');
    const byNode = resolveNotes(parsed.notes!, flat(parsed));
    const bb = flat(parsed).find((n) => n.label === 'Blackbeard')!;
    expect(byNode.get(bb.id)?.body).toBe('commands the fleet');
    expect(errors(parsed.diagnostics)).toHaveLength(0);
  });

  it('errors on an unknown ref', () => {
    const parsed = parseOrg(
      ['org', 'Blackbeard', 'note Silver nope'].join('\n'),
      P
    );
    expect(errors(parsed.diagnostics).length).toBe(1);
    expect(errors(parsed.diagnostics)[0]!.message).toMatch(
      /unknown node id "Silver"/
    );
  });
});

describe('org notes — rendering', () => {
  it('emits a note group with toggle hook + box + connector', () => {
    const svg = parseSvg(org(SRC));
    const note = svg.querySelector('.note');
    expect(note).not.toBeNull();
    expect(note!.hasAttribute('data-note-toggle')).toBe(true);
    expect(note!.getAttribute('data-line-number')).toBe('5');
    expect(svg.querySelector('.note-box')).not.toBeNull();
    expect(svg.querySelector('.note-connector')).not.toBeNull();
  });

  it('colors the note border via a trailing color word', () => {
    const svg = parseSvg(
      org(['org', 'Blackbeard', 'note Blackbeard fierce red'].join('\n'))
    );
    const stroke = svg.querySelector('.note-box')!.getAttribute('stroke')!;
    expect(stroke).toBe(P.colors.red);
    expect(stroke).not.toBe(P.colors.yellow);
  });

  it('keeps the note within a non-negative canvas', () => {
    const parsed = parseOrg(SRC, P);
    const layout = layoutOrg(parsed);
    const annotated = layout.nodes.find((n) => n.note)!;
    expect(annotated.note).toBeTruthy();
    const centerY = annotated.y + annotated.height / 2;
    expect(annotated.x + annotated.note!.x).toBeGreaterThanOrEqual(0);
    expect(centerY + annotated.note!.y).toBeGreaterThanOrEqual(0);
    expect(
      annotated.x + annotated.note!.x + annotated.note!.width
    ).toBeLessThanOrEqual(layout.width);
  });

  it('no-notes suppresses the note entirely', () => {
    const svg = parseSvg(
      org(
        ['org', 'no-notes', 'Blackbeard', 'note Blackbeard hidden'].join('\n')
      )
    );
    expect(svg.querySelector('.note')).toBeNull();
  });

  it('renders a collapsed note as a corner badge', () => {
    const parsed = parseOrg(SRC, P);
    const layout = layoutOrg(
      parsed,
      undefined,
      undefined,
      undefined,
      undefined,
      new Set([5])
    );
    const annotated = layout.nodes.find((n) => n.note)!;
    expect(annotated.note!.collapsed).toBe(true);
  });
});
