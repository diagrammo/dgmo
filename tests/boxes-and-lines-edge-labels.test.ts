import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { renderBoxesAndLines } from '../src/boxes-and-lines/renderer';
import { getPalette } from '../src/palettes';

const P = getPalette('nord').light;

// Two edges each way between the same pair, so applyParallelEdgeOffsets fans
// them — the case where the label used to be placed on a curve nobody drew.
const OAUTH = `boxes-and-lines OAuth 2.0 Authorization Code with PKCE
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
`;

async function renderSvg(src: string): Promise<SVGSVGElement> {
  const parsed = parseBoxesAndLines(src);
  const layout = await layoutBoxesAndLines(parsed);
  const el = document.createElement('div');
  renderBoxesAndLines(el, parsed, layout, P, false, {
    exportDims: { width: 800, height: 600 },
  });
  return el.querySelector('svg')!;
}

type Pt = { x: number; y: number };

function pathPoints(d: string): Pt[] {
  const nums = d.match(/-?\d+\.?\d*/g) ?? [];
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2)
    pts.push({ x: parseFloat(nums[i]!), y: parseFloat(nums[i + 1]!) });
  return pts;
}

function distanceToPolyline(p: Pt, pts: Pt[]): number {
  if (pts.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t =
      len === 0
        ? 0
        : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
    best = Math.min(
      best,
      Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    );
  }
  return best;
}

/** Every edge label, paired with the distance to the path it names. */
function labelDistances(svg: SVGSVGElement): { line: string; d: number }[] {
  const edges = new Map<string, Pt[]>();
  for (const g of Array.from(svg.querySelectorAll('g.bl-edge-group'))) {
    const line = g.getAttribute('data-line-number');
    const d = g.querySelector('path')?.getAttribute('d');
    if (line && d) edges.set(line, pathPoints(d));
  }
  const out: { line: string; d: number }[] = [];
  for (const g of Array.from(svg.querySelectorAll('g.bl-edge-label'))) {
    const line = g.getAttribute('data-line-number');
    const rect = g.querySelector('rect');
    const pts = line ? edges.get(line) : undefined;
    if (!line || !rect || !pts) continue;
    const x = parseFloat(rect.getAttribute('x') ?? '0');
    const y = parseFloat(rect.getAttribute('y') ?? '0');
    const w = parseFloat(rect.getAttribute('width') ?? '0');
    const h = parseFloat(rect.getAttribute('height') ?? '0');
    out.push({
      line,
      d: distanceToPolyline({ x: x + w / 2, y: y + h / 2 }, pts),
    });
  }
  return out;
}

// ------------------------------------------------------------
// #640 — five of thirteen edge labels sat over blank canvas, the worst 216px
// from the line it named, with the four worst parked in a column touching
// nothing.
//
// Layout was never at fault: across 247 labels in 53 real diagrams, not one was
// more than 40px from its edge as placeEdgeLabels computed it. The renderer was
// the second source — applyParallelEdgeOffsets set `yOffset` and left `points`
// alone, so labels were placed against the ROUTED polyline while the renderer
// threw that away and drew a five-point fan. Where the router detoured and the
// fan cut straight across, the label stayed on the abandoned route.
//
// The fan is now built in layout, before placeEdgeLabels, so there is one
// geometry and the label is placed against the curve that gets drawn. 28% of
// real boxes-and-lines diagrams carry a fanned edge and no gallery fixture
// does, which is why the snapshot suite could not see any of this.
// ------------------------------------------------------------
describe('boxes-and-lines — an edge label stays with its edge', () => {
  // The pathology was 216px. Legitimate displacement — dodging a node box,
  // separating from a neighbouring label — runs to ~56px on this diagram, so
  // the bound sits above that and far below a label on an abandoned route.
  const MAX_DETACHMENT = 80;

  it('keeps every label near the line it names, fanned edges included', async () => {
    const svg = await renderSvg(OAUTH);
    const ds = labelDistances(svg);
    expect(ds).toHaveLength(13);
    const far = ds.filter((r) => r.d > MAX_DETACHMENT);
    expect(far.map((r) => `line ${r.line}: ${r.d.toFixed(0)}px`)).toEqual([]);
  });

  it('places the label on the drawn curve for a fanned parallel edge', async () => {
    // Lines 27 and 30 are the two worst offenders — both in the four-edge
    // Client Application ↔ Authorization Server group. They measured 216px and
    // 214px before the geometry moved into layout.
    const svg = await renderSvg(OAUTH);
    const byLine = new Map(labelDistances(svg).map((r) => [r.line, r.d]));
    expect(byLine.get('27')).toBeLessThan(MAX_DETACHMENT);
    expect(byLine.get('30')).toBeLessThan(MAX_DETACHMENT);
  });

  it('gives a fanned edge its five-point geometry in the LAYOUT', async () => {
    // The structural half: if the fan is rebuilt at render time again, the
    // layout's points stay the routed polyline and this fails — catching the
    // regression without depending on any distance threshold.
    const layout = await layoutBoxesAndLines(parseBoxesAndLines(OAUTH));
    const fanned = layout.edges.filter(
      (e) => e.parallelCount > 1 && e.yOffset !== 0
    );
    expect(fanned.length).toBeGreaterThan(0);
    for (const e of fanned) expect(e.points).toHaveLength(5);
  });
});

// ------------------------------------------------------------
// #703 — a label whose edge is shorter than the label is wide sat ON the node
// boxes at either end, because the clear-spot search stopped 40px from the
// line. It now reaches 56px, the displacement the detachment test above
// already calls legitimate. Measured on this fixture: that clears line 29, and
// lines 22 and 26 still cannot be placed without leaving their line by more.
// ------------------------------------------------------------
describe('boxes-and-lines — an edge label clears the boxes it names', () => {
  type Box = { x: number; y: number; width: number; height: number };

  /** Node boxes a label rect covers with non-zero area. */
  function covered(
    label: { x: number; y: number; w: number; h: number },
    nodes: readonly (Box & { label: string })[]
  ): string[] {
    return nodes
      .filter(
        (n) =>
          Math.min(label.x + label.w / 2, n.x + n.width / 2) -
            Math.max(label.x - label.w / 2, n.x - n.width / 2) >
            0 &&
          Math.min(label.y + label.h / 2, n.y + n.height / 2) -
            Math.max(label.y - label.h / 2, n.y - n.height / 2) >
            0
      )
      .map((n) => n.label);
  }

  async function labelsOnBoxes(): Promise<Map<number, string[]>> {
    const layout = await layoutBoxesAndLines(parseBoxesAndLines(OAUTH));
    const out = new Map<number, string[]>();
    for (const e of layout.edges) {
      if (e.labelX === undefined || e.labelY === undefined) continue;
      const hit = covered(
        {
          x: e.labelX,
          y: e.labelY,
          w: e.labelWidth ?? 0,
          h: e.labelHeight ?? 0,
        },
        layout.nodes
      );
      const line = (e as { lineNumber?: number }).lineNumber ?? -1;
      if (hit.length > 0) out.set(line, hit);
    }
    return out;
  }

  it('moves "Signs tokens with" (line 29) off the two boxes it names', async () => {
    const onBoxes = await labelsOnBoxes();
    expect(onBoxes.get(29)).toBeUndefined();
  });

  it('leaves no more than two labels on boxes, down from three', async () => {
    const onBoxes = await labelsOnBoxes();
    expect(onBoxes.size).toBeLessThanOrEqual(2);
  });

  // Review finding, round 1: widening the FIRST search pre-empted the
  // label-reserving relayout, whose result puts labels back on their lines.
  // On this small LR diagram every label sat 0px from its line before the
  // search widened, and two were pushed 48px out with no overlap to fix.
  const CANVAS_SPIKE = `boxes-and-lines E-Commerce Platform

tag Team as t Backend blue, Frontend green, Platform purple

active-tag Team

direction LR

// --- Services ---
API Gateway t: Backend
  Main entry point for all requests
  -routes-> UserService
  -routes-> ProductService

UserService t: Backend
  Handles auth and profiles
  -reads-> UserDB

ProductService t: Frontend, description: Product catalog and search
  -queries-> ProductDB

// --- Data Stores ---
UserDB t: Platform
ProductDB t: Platform`;

  function distanceToOwnLine(
    x: number,
    y: number,
    pts: readonly { x: number; y: number }[]
  ): number {
    let best = Infinity;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t =
        len2 === 0
          ? 0
          : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
      best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
    }
    return best;
  }

  it('does not pull labels off their lines on a diagram with nothing to fix', async () => {
    const layout = await layoutBoxesAndLines(parseBoxesAndLines(CANVAS_SPIKE));
    const far = layout.edges
      .filter((e) => e.labelX !== undefined && e.labelY !== undefined)
      .map((e) => ({
        label: e.label,
        d: distanceToOwnLine(e.labelX!, e.labelY!, e.points),
      }))
      .filter((r) => r.d > 1);
    expect(far).toEqual([]);
  });
});

// A label on an edge that CROSSES a group boundary used to be placed as if the
// group were not there: the obstacle list held node boxes and collapsed groups
// only, so the search reported a clean placement having never looked, and the
// renderer then cut the label's knockout halo through the group's fill, border
// and title (#777). The missing discrimination is containment — a group is valid
// label space for an edge that LIVES in it, an obstacle for one passing through.
describe('boxes-and-lines — an edge label clears groups it does not live in', () => {
  // The reported diagram, trimmed of copy and tags. Four front groups all feed
  // one node inside a fifth, so every inter-group edge ends just inside
  // [The market] and its label used to land astride that group's border.
  const FOUR_FRONTS = `boxes-and-lines Four Fronts, One Barrel Count

[Ukraine and Russia]
  Drone strikes on refineries
    -damaged 54 percent of them-> Russian refining capacity
  Russian refining capacity
    -product exports at a record low-> Barrels off the market

[United States and Iran]
  US strikes on Iranian tankers
    -three disabled or destroyed-> Kharg Island exports
  Kharg Island exports
    -90 percent of Iran's crude-> Barrels off the market

[Houthis and Saudi Arabia]
  Missiles on Aramco sites
    -Jazan, Abha, Najran halted-> Saudi Red Sea route
  Blockade of Saudi shipping
    -Yanbu and the Red Sea-> Saudi Red Sea route
  Saudi Red Sea route
    -Saudi output down 1.9 million barrels a day in August-> Barrels off the market

[Iran and the Gulf states]
  172 strikes on Gulf infrastructure
    -48 percent of them on energy-> Gulf refining and LNG
  Gulf refining and LNG
    -Ras Laffan, Mina al-Ahmadi, Abqaiq, Ruwais-> Barrels off the market

[The market]
  Barrels off the market
    -> Brent above 100 dollars
    -> Record tanker rates
`;

  const NESTED = `boxes-and-lines Nested groups

[Platform]
  [Services]
    Auth
      -verifies-> Sessions
    Sessions
  [Storage]
    Blobs

[Edge]
  CDN
    -asks the platform for a token-> Auth
`;

  type R = { minX: number; minY: number; maxX: number; maxY: number };
  const box = (x: number, y: number, w: number, h: number): R => ({
    minX: x - w / 2,
    minY: y - h / 2,
    maxX: x + w / 2,
    maxY: y + h / 2,
  });
  const hits = (a: R, b: R): boolean =>
    a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
  const within = (inner: R, outer: R): boolean =>
    inner.minX >= outer.minX &&
    inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY &&
    inner.maxY <= outer.maxY;

  /** Every (label, group) pair whose boxes intersect. Membership is deliberately
   *  NOT applied here — each test states what it expects, so the assertions do
   *  not re-implement (and so cannot mirror a bug in) the containment rule. */
  async function labelGroupOverlaps(
    src: string
  ): Promise<{ label: string; group: string; inside: boolean }[]> {
    const layout = await layoutBoxesAndLines(parseBoxesAndLines(src));
    const out: { label: string; group: string; inside: boolean }[] = [];
    for (const e of layout.edges) {
      if (!e.label || e.labelX === undefined || e.labelY === undefined)
        continue;
      const lr = box(e.labelX, e.labelY, e.labelWidth ?? 0, e.labelHeight ?? 0);
      for (const g of layout.groups) {
        const gr = box(g.x, g.y, g.width, g.height);
        if (hits(lr, gr))
          out.push({ label: e.label, group: g.label, inside: within(lr, gr) });
      }
    }
    return out;
  }

  it('keeps every cross-group label off the group it crosses into', async () => {
    // FOUR_FRONTS has no nesting, so the only group a label may sit in is the
    // one holding BOTH endpoints of its own edge.
    const parsed = parseBoxesAndLines(FOUR_FRONTS);
    const owner = new Map<string, string>();
    for (const g of parsed.groups)
      for (const c of g.children) owner.set(c, g.label);
    const layout = await layoutBoxesAndLines(parsed);

    const straddles: string[] = [];
    for (const e of layout.edges) {
      if (!e.label || e.labelX === undefined || e.labelY === undefined)
        continue;
      const lr = box(e.labelX, e.labelY, e.labelWidth ?? 0, e.labelHeight ?? 0);
      for (const g of layout.groups) {
        if (owner.get(e.source) === g.label && owner.get(e.target) === g.label)
          continue;
        if (hits(lr, box(g.x, g.y, g.width, g.height)))
          straddles.push(`"${e.label}" over [${g.label}]`);
      }
    }
    expect(straddles).toEqual([]);
  });

  it('still lets a label sit inside the group its own edge lives in', async () => {
    // The other half of the rule: five of this diagram's labels belong to edges
    // wholly inside a front group. Evicting those would be the same defect
    // wearing the opposite sign, and a search told to clear every group would.
    const inside = (await labelGroupOverlaps(FOUR_FRONTS))
      .filter((h) => h.inside)
      .map((h) => h.label);
    expect(inside).toContain('damaged 54 percent of them');
    expect(inside).toContain('three disabled or destroyed');
    expect(inside).toContain('Jazan, Abha, Najran halted');
    expect(inside).toContain('Yanbu and the Red Sea');
    expect(inside).toContain('48 percent of them on energy');
  });

  it('does not evict a label from the ANCESTOR of the group it lives in', async () => {
    // Containment is transitive: `verifies` runs between two boxes in [Services],
    // which sits in [Platform], so both are valid space for it. A containment
    // test looking only at the immediate group would push it out of [Platform],
    // and no other fixture in the corpus has a nested group to catch that.
    const groups = (await labelGroupOverlaps(NESTED))
      .filter((h) => h.label === 'verifies')
      .map((h) => h.group)
      .sort();
    expect(groups).toEqual(['Platform', 'Services']);
  });

  it('clears a label crossing INTO a nested group, its parent included', async () => {
    const groups = (await labelGroupOverlaps(NESTED))
      .filter((h) => h.label === 'asks the platform for a token')
      .map((h) => h.group);
    expect(groups).toEqual([]);
  });
});
