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
