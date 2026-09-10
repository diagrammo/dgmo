import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { applyCollapseProjection } from '../src/sequence/collapse';
import { renderSequenceDiagram } from '../src/sequence/renderer';
import { resolveSequenceTags } from '../src/sequence/tag-resolution';
import { getPalette } from '../src/palettes';

let doc: Document;
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  doc = win.document;
  for (const [key, value] of [
    ['document', doc],
    ['window', win],
    ['navigator', win.navigator],
    ['HTMLElement', win.HTMLElement],
    ['SVGElement', win.SVGElement],
  ] as const) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
});

const palette = getPalette('nord').light;

/**
 * The shape the defect was found on: a group indented inside another, with
 * more members of the OUTER group written after it. Before nesting existed,
 * `[Linux]` parsed as a sibling and captured FanScreen and StaffScreen too.
 */
const nested = [
  'sequence Monolith',
  '[MLB Cloud]',
  '  GAEServices',
  '',
  '[Monolith]',
  '  Camera',
  '  [Linux]',
  '    FacialCapture',
  '    GAEEdgeSW',
  '  FanScreen',
  '  StaffScreen',
  '',
  'Camera -video-> FacialCapture',
  'FacialCapture -frame-> GAEEdgeSW',
  'GAEEdgeSW -good-> FanScreen',
  'GAEEdgeSW -good-> StaffScreen',
  'GAEEdgeSW -check-> GAEServices',
].join('\n');

const groupNamed = (
  parsed: ReturnType<typeof parseSequenceDgmo>,
  name: string
) => parsed.groups.find((g) => g.name === name);

function renderToSvg(input: string, exportWidth = 1200): SVGSVGElement {
  const parsed = parseSequenceDgmo(input);
  expect(parsed.error).toBeNull();
  const container = doc.createElement('div') as unknown as HTMLDivElement;
  doc.body.appendChild(container);
  renderSequenceDiagram(container, parsed, palette, false, undefined, {
    exportWidth,
  });
  const svg = container.querySelector('svg');
  doc.body.removeChild(container);
  expect(svg).not.toBeNull();
  return svg!;
}

/** Every drawn left/right extent: group frames plus participant boxes. */
function drawnExtents(svg: SVGSVGElement): { left: number; right: number } {
  const spans: Array<[number, number]> = [];
  for (const r of svg.querySelectorAll('rect.group-box')) {
    const x = Number(r.getAttribute('x'));
    spans.push([x, x + Number(r.getAttribute('width'))]);
  }
  for (const g of svg.querySelectorAll('g.participant[data-participant-id]')) {
    const tx = /translate\(\s*(-?[\d.]+)/.exec(
      g.getAttribute('transform') ?? ''
    );
    const r = g.querySelector('rect');
    if (!tx || !r) continue;
    const x = Number(tx[1]) + Number(r.getAttribute('x'));
    spans.push([x, x + Number(r.getAttribute('width'))]);
  }
  return {
    left: Math.min(...spans.map(([a]) => a)),
    right: Math.max(...spans.map(([, b]) => b)),
  };
}

/**
 * Every participant's lifeline centre, by id. The box is drawn in local
 * coordinates inside a translated <g>, so the centre is the translate's x.
 */
function columnXs(svg: SVGSVGElement): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of svg.querySelectorAll('g.participant[data-participant-id]')) {
    const id = g.getAttribute('data-participant-id');
    const tx = /translate\(\s*(-?[\d.]+)/.exec(
      g.getAttribute('transform') ?? ''
    );
    if (id && tx) out.set(id, Number(tx[1]));
  }
  return out;
}

/** The frame rect of a named group box, by its label. */
function frameOf(svg: SVGSVGElement, name: string) {
  const label = Array.from(svg.querySelectorAll('text.group-label')).find(
    (t) => t.textContent === name
  );
  expect(label, `no group frame labelled ${name}`).toBeDefined();
  const rect = label!.parentElement!.querySelector('rect.group-box')!;
  const num = (attr: string) => Number(rect.getAttribute(attr));
  return {
    x: num('x'),
    y: num('y'),
    width: num('width'),
    height: num('height'),
  };
}

describe('Sequence participant groups — one level of nesting (§2.3)', () => {
  // ──────────────────────────────────────────────────
  // Parsing
  // ──────────────────────────────────────────────────

  it('nests an indented group instead of making it a sibling', () => {
    const parsed = parseSequenceDgmo(nested);
    expect(parsed.error).toBeNull();

    const linux = groupNamed(parsed, 'Linux');
    expect(linux?.parent).toBe('Monolith');
    expect(linux?.depth).toBe(1);
    expect(linux?.participantIds).toEqual(['FacialCapture', 'GAEEdgeSW']);
  });

  it('returns the participants written after the inner group to their parent', () => {
    // The defect itself: FanScreen and StaffScreen dedent back to the outer
    // level and used to be captured by [Linux], leaving [Monolith] with one
    // member. Nothing reported it — the parse was clean either way.
    const parsed = parseSequenceDgmo(nested);
    expect(groupNamed(parsed, 'Monolith')?.participantIds).toEqual([
      'Camera',
      'FacialCapture',
      'GAEEdgeSW',
      'FanScreen',
      'StaffScreen',
    ]);
    expect(groupNamed(parsed, 'Linux')?.participantIds).not.toContain(
      'FanScreen'
    );
  });

  it('keeps a nested group’s members contiguous inside its parent’s list', () => {
    // The renderer relies on this: an inner frame spans min..max of its own
    // members, so a parent that interleaved them would draw a frame across
    // columns that are not in it.
    const monolith = groupNamed(parseSequenceDgmo(nested), 'Monolith')!;
    const linux = groupNamed(parseSequenceDgmo(nested), 'Linux')!;
    const positions = linux.participantIds.map((id) =>
      monolith.participantIds.indexOf(id)
    );
    expect(Math.max(...positions) - Math.min(...positions)).toBe(
      positions.length - 1
    );
  });

  it('does not nest a group that dedents back to the top level', () => {
    const parsed = parseSequenceDgmo(nested);
    const mlb = groupNamed(parsed, 'MLB Cloud');
    expect(mlb?.parent).toBeUndefined();
    expect(mlb?.depth).toBe(0);
    expect(groupNamed(parsed, 'Monolith')?.depth).toBe(0);
  });

  it('leaves a flat diagram exactly as it was', () => {
    const parsed = parseSequenceDgmo(
      ['sequence', '[Backend]', '  API', '  DB', 'API -q-> DB'].join('\n')
    );
    expect(parsed.error).toBeNull();
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0]?.depth).toBe(0);
    expect(parsed.groups[0]?.parent).toBeUndefined();
    expect(parsed.groups[0]?.participantIds).toEqual(['API', 'DB']);
  });

  it('refuses a third level and files its participants into the group above', () => {
    const parsed = parseSequenceDgmo(
      [
        'sequence',
        '[Data centre]',
        '  [Monolith]',
        '    [Linux]',
        '      App',
        '    Camera',
        'App -ping-> Camera',
      ].join('\n')
    );

    const depthError = parsed.diagnostics.find(
      (d) => d.code === 'E_SEQ_GROUP_DEPTH'
    );
    expect(depthError?.line).toBe(4);
    expect(depthError?.message).toContain('Linux');

    // The refused group never opens, so App joins [Monolith] rather than
    // vanishing — same recovery sketch uses for a too-deep [Box].
    expect(groupNamed(parsed, 'Linux')).toBeUndefined();
    expect(groupNamed(parsed, 'Monolith')?.participantIds).toEqual([
      'App',
      'Camera',
    ]);
    expect(groupNamed(parsed, 'Data centre')?.participantIds).toEqual([
      'App',
      'Camera',
    ]);
  });

  it('still refuses a participant claimed by two unrelated groups', () => {
    const parsed = parseSequenceDgmo(
      ['sequence', '[One]', '  API', '', '[Two]', '  API', 'API -q-> API'].join(
        '\n'
      )
    );
    expect(parsed.error).toContain('already in group');
  });

  // ──────────────────────────────────────────────────
  // Collapse
  // ──────────────────────────────────────────────────

  it('collapsing the outer group swallows the inner one whole', () => {
    const parsed = parseSequenceDgmo(nested);
    const monolith = groupNamed(parsed, 'Monolith')!;
    const view = applyCollapseProjection(
      parsed,
      new Set([monolith.lineNumber])
    );

    // One virtual lifeline, not two: the inner group must not mint a second
    // one for members the outer has already absorbed.
    // Declaration order, with the virtual lifeline standing where the first
    // absorbed member stood.
    expect(view.participants.map((p) => String(p.id))).toEqual([
      'GAEServices',
      'Monolith',
    ]);
    expect(view.groups.map((g) => g.name)).toEqual(['MLB Cloud']);
  });

  it('collapsing only the inner group leaves it as a column of its parent', () => {
    const parsed = parseSequenceDgmo(nested);
    const linux = groupNamed(parsed, 'Linux')!;
    const view = applyCollapseProjection(parsed, new Set([linux.lineNumber]));

    expect(view.participants.map((p) => String(p.id))).toContain('Linux');
    expect(view.participants.map((p) => String(p.id))).not.toContain(
      'FacialCapture'
    );

    // The surviving outer frame has to span the virtual participant, because
    // the members it used to name are no longer columns.
    const monolith = view.groups.find((g) => g.name === 'Monolith');
    expect(monolith?.participantIds).toEqual([
      'Camera',
      'Linux',
      'FanScreen',
      'StaffScreen',
    ]);
  });

  // ──────────────────────────────────────────────────
  // Tags
  // ──────────────────────────────────────────────────

  it('lets a nested group’s tag beat the one it sits inside', () => {
    const parsed = parseSequenceDgmo(
      [
        'sequence',
        'tag Owner as o',
        '  MLB red',
        '  NEC blue',
        '',
        '[Monolith] o: MLB',
        '  Camera',
        '  [Linux] o: NEC',
        '    FacialCapture',
        'Camera -video-> FacialCapture',
      ].join('\n')
    );
    expect(parsed.error).toBeNull();

    const tags = resolveSequenceTags(parsed, 'Owner');
    expect(tags.participants.get('FacialCapture')).toBe('NEC');
    expect(tags.participants.get('Camera')).toBe('MLB');
  });

  // ──────────────────────────────────────────────────
  // Rendering
  // ──────────────────────────────────────────────────

  it('draws the inner frame inside the outer one, on all four sides', () => {
    const svg = renderToSvg(nested);
    const monolith = frameOf(svg, 'Monolith');
    const linux = frameOf(svg, 'Linux');

    expect(linux.x).toBeGreaterThan(monolith.x);
    expect(linux.x + linux.width).toBeLessThan(monolith.x + monolith.width);
    expect(linux.y).toBeGreaterThan(monolith.y);
    // The bottom edges must not share a line — the two frames read as one box
    // with a divider when they do.
    expect(linux.y + linux.height).toBeLessThan(monolith.y + monolith.height);
    expect(monolith.y + monolith.height - (linux.y + linux.height)).toBe(6);
  });

  it('bisects the gap to the column on either side of the nested group', () => {
    const svg = renderToSvg(nested);
    const linux = frameOf(svg, 'Linux');
    const x = columnXs(svg);

    // Camera | FacialCapture … GAEEdgeSW | FanScreen — the frame's borders land
    // halfway between the centres, which for uniformly wide boxes centred on
    // their lifelines is halfway between the boxes.
    expect(linux.x).toBeCloseTo(
      (x.get('Camera')! + x.get('FacialCapture')!) / 2,
      3
    );
    expect(linux.x + linux.width).toBeCloseTo(
      (x.get('GAEEdgeSW')! + x.get('FanScreen')!) / 2,
      3
    );
  });

  it('keeps a nested frame inside its parent when the neighbour is outside it', () => {
    // [Inner] is the whole of [Outer], so the columns either side of it are
    // outside the parent too — bisecting to them would put the inner frame
    // through the outer one's wall.
    const svg = renderToSvg(
      [
        'sequence',
        'Client',
        '',
        '[Outer]',
        '  [Inner]',
        '    A',
        '    B',
        '',
        'Server',
        'Client -go-> A',
        'A -on-> B',
        'B -done-> Server',
      ].join('\n')
    );
    const outer = frameOf(svg, 'Outer');
    const inner = frameOf(svg, 'Inner');

    expect(inner.x).toBeGreaterThanOrEqual(outer.x);
    expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width);
  });

  it('draws the outer frame first so the inner one takes its own clicks', () => {
    const svg = renderToSvg(nested);
    const labels = Array.from(svg.querySelectorAll('text.group-label')).map(
      (t) => t.textContent
    );
    expect(labels.indexOf('Monolith')).toBeLessThan(labels.indexOf('Linux'));
  });

  it('aligns every top-level frame on one top edge', () => {
    const svg = renderToSvg(nested);
    expect(frameOf(svg, 'MLB Cloud').y).toBe(frameOf(svg, 'Monolith').y);
  });

  it('keeps the outermost group frame clear of both canvas edges', () => {
    // 🔴 The left margin was a bare `sGap / 2` that budgeted for neither the
    // participant box nor the group frame around it, so a leftmost member
    // inside a [Group] had its frame drawn flush against the canvas edge —
    // or cut by it. Rendered at its own ideal width, where the margins are
    // the whole story and centring cannot mask them.
    // A width the diagram must COMPRESS into, so the content fills the canvas
    // and the margins are all that stand between a frame and the edge. Given
    // slack, centring would supply the clearance and hide a missing margin.
    const svg = renderToSvg(nested, 700);
    const width = Number(svg.getAttribute('viewBox')?.split(' ')[2]);
    const { left, right } = drawnExtents(svg);

    expect(left).toBeGreaterThan(0);
    expect(right).toBeLessThan(width);
    // Same air on both sides — the two used to be computed by different rules.
    expect(left).toBeCloseTo(width - right, 3);
  });

  it('spends one extra header strip only when something nests', () => {
    const flat = [
      'sequence Monolith',
      '[MLB Cloud]',
      '  GAEServices',
      '',
      '[Monolith]',
      '  Camera',
      '  FacialCapture',
      '  GAEEdgeSW',
      '  FanScreen',
      '  StaffScreen',
      '',
      'Camera -video-> FacialCapture',
      'FacialCapture -frame-> GAEEdgeSW',
      'GAEEdgeSW -good-> FanScreen',
      'GAEEdgeSW -good-> StaffScreen',
      'GAEEdgeSW -check-> GAEServices',
    ].join('\n');

    const flatFrame = frameOf(renderToSvg(flat), 'Monolith');
    const nestedFrame = frameOf(renderToSvg(nested), 'Monolith');

    // GROUP_PADDING_TOP above (22) plus GROUP_NEST_INSET_Y below (6), which
    // is the room the inner frame's bottom edge needs to clear this one.
    // Asserted as a difference rather than an absolute so it survives any
    // other change to the band.
    //
    // The band grows DOWNWARD from a pinned top edge: an outer frame starts
    // where it always did, and the extra strip pushes the participant row
    // down instead. So the top-level frame's own y must not move — that is
    // what keeps a nested diagram sitting under its legend like a flat one.
    expect(nestedFrame.height - flatFrame.height).toBe(28);
    expect(nestedFrame.y).toBe(flatFrame.y);
  });
});
