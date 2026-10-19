import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { parseState } from '../src/graph/state-parser';
import { layoutGraph, wrapNodeLabel } from '../src/graph/layout';
import { noteConnectorPoints } from '../src/utils/note-box';
import { placeNotes } from '../src/utils/notes/place';
import { renderForExport } from '../src/d3';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const key of [
    'document',
    'window',
    'navigator',
    'HTMLElement',
    'SVGElement',
  ] as const) {
    const value = key === 'window' ? win : (win as never)[key];
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
});

type Box = { x: number; y: number; width: number; height: number };

/** Does the segment pass through the inside of the (centre-sized) box? */
function crosses(x1: number, y1: number, x2: number, y2: number, b: Box) {
  const r = {
    left: b.x - b.width / 2,
    right: b.x + b.width / 2,
    top: b.y - b.height / 2,
    bottom: b.y + b.height / 2,
  };
  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - r.left, r.right - x1, y1 - r.top, r.bottom - y1];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i]! <= 0) return false;
      continue;
    }
    const t = q[i]! / p[i]!;
    if (p[i]! < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  return t0 < t1;
}

// ------------------------------------------------------------
// #1400 — "Could be a little prettier", reported from inside the app on a
// flowchart at dgmo 0.91.1. Two faults, both from the owner's scope:
//   1. a long node label drew as one line, so its shape came out ~560px wide;
//   2. the note on "Forward tickets…" had nowhere clear beside its node, so
//      the old fallback pushed it past its neighbour and the connector ran
//      straight through "Delegated organization…", reading as that node's.
// The source is the reporter's, verbatim: label lengths are the fault.
// ------------------------------------------------------------
const REPORTED = `flowchart Current ticket workflow - Cubs Postseason example
direction-tb

(Start) -> [MLB approves Postseason pricing]
(Start) -requests collected in parallel-> [Global Events surveys departments]
[MLB approves Postseason pricing] -> [Cubs purchase source tickets in ProVenue]
[Cubs purchase source tickets in ProVenue] -seat and price file-> [Global Events verifies and copies inventory into Archtics]
[Cubs purchase source tickets in ProVenue] -separate order file in different format-> [MLB Ticketing imports orders into Groupmatics]
[Global Events surveys departments] -> /Departments submit requests by email or paper/
/Departments submit requests by email or paper/ -> [Global Events approves requests]
[Global Events approves requests] -> [Global Events assigns seats using Archtics hold codes]
[Global Events verifies and copies inventory into Archtics] -> [Global Events assigns seats using Archtics hold codes]
[Global Events assigns seats using Archtics hold codes] -> [Export seats and departmental holds to spreadsheets~]
[Export seats and departmental holds to spreadsheets~] -> [Staff bulk allocate matching tickets in Groupmatics]
[MLB Ticketing imports orders into Groupmatics] -> [Staff bulk allocate matching tickets in Groupmatics]
[Staff bulk allocate matching tickets in Groupmatics] -> [Departments manage allotments in Groupmatics]
[Departments manage allotments in Groupmatics] -payment work-> [Departments process client card or internal charge payment]
[Departments process client card or internal charge payment] -> [Departments update payment record in Archtics]
[Departments update payment record in Archtics] -> (Payment recorded)
[Departments manage allotments in Groupmatics] -distribution work-> [Forward tickets from Groupmatics to Ballpark accounts]
[Forward tickets from Groupmatics to Ballpark accounts] -> (Recipient can access ticket - delivery complete)
[Departments manage allotments in Groupmatics] -optional delegation-> [Delegated organization manages or allocates a subset]
[Delegated organization manages or allocates a subset] -> (Parent retains visibility and reclaim authority)

note "Global Events approves requests" Department financial responsibility begins here.
note "MLB Ticketing imports orders into Groupmatics" Groupmatics and ProVenue share a ticket ID; Archtics does not.
note "Departments manage allotments in Groupmatics" Tickets generally cannot be returned. The department remains financially responsible.
note "Forward tickets from Groupmatics to Ballpark accounts" Payment ideally comes first, but forwarding can precede collection. Assignment or a delivery request alone does not mean delivery is complete.
`;

/** The widest a wrapped label can make a shape: 24 chars at 9px + 40. */
const WRAPPED_BOUND = 24 * 9 + 40;

describe('flowchart — wrapped labels and clear note connectors (#1400)', () => {
  const layout = layoutGraph(parseFlowchart(REPORTED));

  it('wraps every long label, so no shape passes the wrapped bound', () => {
    for (const n of layout.nodes)
      expect(n.width).toBeLessThanOrEqual(WRAPPED_BOUND);
    const wide = layout.nodes.find(
      (n) =>
        n.label === 'Global Events verifies and copies inventory into Archtics'
    )!;
    expect(wrapNodeLabel(wide.label).length).toBeGreaterThan(1);
    expect(wide.height).toBeGreaterThan(50);
  });

  it('draws a connector from each note that crosses no other shape', () => {
    const noted = layout.nodes.filter((n) => n.note && !n.note.collapsed);
    expect(noted.map((n) => n.label)).toContain(
      'Forward tickets from Groupmatics to Ballpark accounts'
    );
    for (const n of noted) {
      const [x1, y1, x2, y2] = noteConnectorPoints(n, n.note!);
      const hits = layout.nodes
        .filter((o) => o !== n)
        .filter((o) => crosses(n.x + x1, n.y + y1, n.x + x2, n.y + y2, o))
        .map((o) => o.label);
      expect({ note: n.label, hits }).toEqual({ note: n.label, hits: [] });
    }
  });

  // The owner's check, 2026-10-19: the "Payment ideally comes first…" note
  // sat on the edge into "Departments process client card…".
  it('keeps every note box off every edge line', () => {
    for (const n of layout.nodes.filter((m) => m.note && !m.note.collapsed)) {
      const box = {
        x: n.x + n.note!.x + n.note!.width / 2,
        y: n.y + n.note!.y + n.note!.height / 2,
        width: n.note!.width,
        height: n.note!.height,
      };
      const hits = layout.edges
        .filter((e) =>
          e.points.some(
            (pt, i) =>
              i > 0 &&
              crosses(e.points[i - 1]!.x, e.points[i - 1]!.y, pt.x, pt.y, box)
          )
        )
        .map((e) => `${e.source} -> ${e.target}`);
      expect({ note: n.label, hits }).toEqual({ note: n.label, hits: [] });
    }
  });

  it('renders every wrapped line of a label', async () => {
    const svg = await renderForExport(REPORTED, 'light');
    for (const line of wrapNodeLabel(
      'Global Events verifies and copies inventory into Archtics'
    ))
      expect(svg).toContain(`>${line}</tspan>`);
  });
});

describe('wrapNodeLabel', () => {
  it('keeps a short label on one line, untouched', () => {
    expect(wrapNodeLabel('Global  Events approves')).toEqual([
      'Global  Events approves',
    ]);
  });

  it('splits a long label at spaces into even lines', () => {
    const lines = wrapNodeLabel(
      'Global Events verifies and copies inventory into Archtics'
    );
    expect(lines.join(' ')).toBe(
      'Global Events verifies and copies inventory into Archtics'
    );
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(24);
  });

  it('keeps a word longer than the limit on a line of its own', () => {
    expect(wrapNodeLabel('Supercalifragilisticexpialidocious end')).toEqual([
      'Supercalifragilisticexpialidocious',
      'end',
    ]);
  });
});

describe('state charts do not wrap', () => {
  it('sizes a long state label on one line, as before', () => {
    const label = 'Waiting for the payment provider to confirm';
    const layout = layoutGraph(parseState(`state\n${label} -> Done`));
    const node = layout.nodes.find((n) => n.label === label)!;
    expect(node.width).toBe(label.length * 9 + 40);
  });
});

describe('placeNotes — the connector must be clear, not only the box', () => {
  it('leaves the default side when its box is clear but its connector is blocked', () => {
    const anchor = { x: 0, y: 0, width: 100, height: 50 };
    // A small shape in the gap between the node and the right-side note:
    // the note box clears it by NOTE_CLEAR, the connector runs through it.
    const inGap = { x: 54.5, y: 0, width: 5, height: 10 };
    const placed = placeNotes(
      [anchor, inGap],
      [{ key: 'a', node: anchor, noteW: 80, noteH: 40, collapsed: false }],
      'TB'
    ).get('a')!;
    expect(placed.side).not.toBe('right');
    const [x1, y1, x2, y2] = noteConnectorPoints(anchor, {
      ...placed,
      width: 80,
      height: 40,
    });
    expect(crosses(x1, y1, x2, y2, inGap)).toBe(false);
  });

  it('keeps the default side when nothing is in the way', () => {
    const anchor = { x: 0, y: 0, width: 100, height: 50 };
    const placed = placeNotes(
      [anchor],
      [{ key: 'a', node: anchor, noteW: 80, noteH: 40, collapsed: false }],
      'TB'
    ).get('a')!;
    expect(placed.side).toBe('right');
  });
});
