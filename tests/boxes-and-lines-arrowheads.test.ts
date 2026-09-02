import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { renderBoxesAndLines } from '../src/boxes-and-lines/renderer';
import { getPalette } from '../src/palettes';

const P = getPalette('nord').light;

async function render(src: string): Promise<SVGSVGElement> {
  const parsed = parseBoxesAndLines(src);
  const layout = await layoutBoxesAndLines(parsed);
  const el = document.createElement('div');
  renderBoxesAndLines(el, parsed, layout, P, false, {
    exportDims: { width: 800, height: 600 },
  });
  return el.querySelector('svg')!;
}

type Rect = { label: string; x: number; y: number; w: number; h: number };

/** Node boxes in the SVG's own coordinate space (group transform + local rect). */
function nodeRects(svg: SVGSVGElement): Rect[] {
  const out: Rect[] = [];
  for (const g of Array.from(svg.querySelectorAll('g.bl-node'))) {
    const m = /translate\(([-\d.]+)[ ,]([-\d.]+)\)/.exec(
      g.getAttribute('transform') ?? ''
    );
    const rect = g.querySelector('rect');
    if (!m || !rect) continue;
    out.push({
      label: g.getAttribute('data-node-id') ?? '?',
      x: parseFloat(m[1]!),
      y: parseFloat(m[2]!),
      w: parseFloat(rect.getAttribute('width') ?? '0'),
      h: parseFloat(rect.getAttribute('height') ?? '0'),
    });
  }
  return out;
}

/** The final point of every edge path that carries an arrowhead. */
function arrowTips(svg: SVGSVGElement): { x: number; y: number }[] {
  const tips: { x: number; y: number }[] = [];
  for (const p of Array.from(svg.querySelectorAll('path[marker-end]'))) {
    const d = p.getAttribute('d') ?? '';
    const tail = d.includes('L') ? d.slice(d.lastIndexOf('L')) : d;
    const nums = tail.match(/-?\d+\.?\d*/g) ?? [];
    if (nums.length < 2) continue;
    tips.push({
      x: parseFloat(nums[nums.length - 2]!),
      y: parseFloat(nums[nums.length - 1]!),
    });
  }
  return tips;
}

/**
 * An arrowhead strictly inside a node box is invisible: edges paint before
 * nodes, so the node's opaque rect covers it. Half a pixel of tolerance keeps a
 * correctly clipped endpoint — which sits exactly ON the boundary — from
 * counting as buried.
 */
function buried(svg: SVGSVGElement): string[] {
  const rects = nodeRects(svg);
  const hits: string[] = [];
  for (const t of arrowTips(svg))
    for (const r of rects)
      if (
        Math.abs(t.x - r.x) < r.w / 2 - 0.5 &&
        Math.abs(t.y - r.y) < r.h / 2 - 0.5
      )
        hits.push(`(${t.x},${t.y}) inside ${r.label}`);
  return hits;
}

// ------------------------------------------------------------
// #625 — "the arrows are hidden inside under the nodes in this diagram you
// can't see the direction of the flows", reported from inside the app on an
// OAuth flow at dgmo 0.80.0. All 13 arrowheads sat at their target node's exact
// centre, under the box.
//
// Three independent causes stacked on one diagram, which is why a fix for any
// one of them left arrowheads buried:
//   1. layout-grouped / layout-layered route centre-to-centre and never clip to
//      the node boundary (only dagre clips for itself).
//   2. dagre's own intersectRect throws on some configs; the edges it cannot
//      solve keep the centre.
//   3. the renderer's parallel-edge fan re-derived a port's y from the layout
//      node's centre while taking x from the routed polyline.
// Assert on RENDERED output, not on layout: cause 3 lives past the layout.
// ------------------------------------------------------------
describe('boxes-and-lines — arrowheads clear their target node', () => {
  it('never buries an arrowhead on the reported OAuth flow', async () => {
    const svg =
      await render(`boxes-and-lines OAuth 2.0 Authorization Code with PKCE
direction-lr

tag Role as r
  Client blue
  Service green
  Data purple

[Client Environment]
  User r: Client, description: Resource owner
  Client Application r: Client, description: Web, mobile, or desktop application

[Authorization System]
  Authorization Server r: Service, description: Authenticates users and issues tokens
  Login and Consent UI r: Service, description: Collects credentials and authorization consent
  User Directory r: Data, description: User identities, credentials, and grants
  Signing Keys r: Data, description: Private signing keys and published public keys

[Protected APIs]
  Resource Server r: Service, description: API that accepts access tokens

User -1. Starts sign-in-> Client Application
Client Application -2. Authorization request + PKCE challenge-> Authorization Server
Authorization Server -3. Login and consent-> Login and Consent UI
Login and Consent UI -4. Authenticates user-> User
Login and Consent UI -Checks identity and grants-> User Directory
Authorization Server -5. Authorization code via redirect-> Client Application
Client Application -6. Code + PKCE verifier-> Authorization Server
Authorization Server -Signs tokens with-> Signing Keys
Authorization Server -7. Access, ID, and refresh tokens-> Client Application
Client Application -8. API request + bearer token-> Resource Server
Resource Server -Fetches JWKS-> Authorization Server
Resource Server -9. Protected resource-> Client Application
Client Application -10. Displays result-> User
`);
    expect(arrowTips(svg)).toHaveLength(13);
    expect(buried(svg)).toEqual([]);
  });

  it('survives the duplicate-pair edge that flips the layout engine', async () => {
    // A second edge between an ordered pair already joined makes dagre throw for
    // most of its candidate configs; the pool collapses, badness crosses
    // ESCALATE_THRESHOLD, and a hand-rolled grouped candidate wins instead —
    // which is when every arrowhead used to vanish at once.
    const withDuplicate = `boxes-and-lines T
direction-lr

[Left]
  A description: first
  B description: second

[Right]
  C description: third

A -one-> B
B -two-> C
C -three-> A
B -four-> C
`;
    const svg = await render(withDuplicate);
    expect(arrowTips(svg)).toHaveLength(4);
    expect(buried(svg)).toEqual([]);
  });

  it('keeps a plain two-node edge clipped to the boundary', async () => {
    const svg = await render('boxes-and-lines T\nA -go-> B\n');
    expect(buried(svg)).toEqual([]);
  });

  it('keeps anti-parallel edges — the renderer fan path — clear', async () => {
    // yOffset !== 0 && parallelCount > 1 is the branch that rebuilt ports from
    // node centres.
    const svg = await render('boxes-and-lines T\nA -there-> B\nB -back-> A\n');
    expect(buried(svg)).toEqual([]);
  });
});
