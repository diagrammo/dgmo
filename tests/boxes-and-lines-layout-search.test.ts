import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { collapseBoxesAndLines } from '../src/boxes-and-lines/collapse';
import {
  layoutBoxesAndLines,
  type BLLayoutResult,
} from '../src/boxes-and-lines/layout';
import {
  layoutBoxesAndLinesSearch,
  countSplineCrossings,
  type BLSearchConfig,
} from '../src/boxes-and-lines/layout-search';

// A small dense fixture (K-ish connectivity + a back-edge) — enough edges that
// the seed search has real choices to rank, so determinism is meaningful.
const DENSE = [
  'boxes-and-lines',
  'A -> B',
  'A -> C',
  'B -> D',
  'C -> D',
  'A -> D',
  'B -> C',
  'D -> A',
].join('\n');

const LABELED = [
  'boxes-and-lines',
  'API -queries the primary replica for reads-> DB',
  'API -writes through the cache invalidation path-> Cache',
  'Cache -evicts stale entries back to-> DB',
  'Worker -drains the outbox table into-> DB',
  'API -enqueues background jobs onto-> Worker',
].join('\n');

/** Geometry fingerprint — node positions + edge waypoints only. */
function geom(layout: BLLayoutResult): string {
  return JSON.stringify({
    nodes: layout.nodes.map((n) => [n.label, n.x, n.y, n.width, n.height]),
    edges: layout.edges.map((e) => [e.source, e.target, e.points]),
  });
}

/** Minimal synthetic layout for exercising countSplineCrossings directly. */
function syntheticLayout(
  nodes: { label: string; x: number; y: number }[],
  edges: {
    source: string;
    target: string;
    points: { x: number; y: number }[];
  }[]
): BLLayoutResult {
  return {
    nodes: nodes.map((n) => ({ ...n, width: 40, height: 24 })),
    edges: edges.map((e, i) => ({
      source: e.source,
      target: e.target,
      bidirectional: false,
      lineNumber: i + 1,
      points: e.points,
      yOffset: 0,
      parallelCount: 1,
      metadata: {},
    })),
    groups: [],
    width: 400,
    height: 400,
  };
}

describe('boxes-and-lines layout search', () => {
  it('is deterministic — two searches over the same input produce identical geometry', async () => {
    const a = await layoutBoxesAndLinesSearch(parseBoxesAndLines(DENSE));
    const b = await layoutBoxesAndLinesSearch(parseBoxesAndLines(DENSE));
    expect(geom(a)).toBe(geom(b));
  });

  it('reports the top-ranked candidate configs via onTopConfigs', async () => {
    let top: BLSearchConfig[] = [];
    await layoutBoxesAndLinesSearch(parseBoxesAndLines(DENSE), undefined, {
      onTopConfigs: (cfgs) => {
        top = cfgs;
      },
    });
    expect(top.length).toBeGreaterThan(0);
    // Default refineK is 6; escalation may add up to ESCALATE_REFINE more.
    expect(top.length).toBeLessThanOrEqual(16);
    for (const cfg of top) {
      expect(typeof cfg.ranker).toBe('string');
      expect(cfg.nodesep).toBeGreaterThan(0);
      expect(cfg.ranksep).toBeGreaterThan(0);
    }
  });

  it('restricting the pool to reported configs yields a complete, deterministic layout', async () => {
    const parsed = parseBoxesAndLines(LABELED);
    let top: BLSearchConfig[] = [];
    await layoutBoxesAndLinesSearch(parsed, undefined, {
      onTopConfigs: (cfgs) => {
        top = cfgs;
      },
    });
    expect(top.length).toBeGreaterThan(0);

    // The label-reserving relayout path: same configs, reservation on.
    const relaidA = await layoutBoxesAndLinesSearch(parsed, undefined, {
      configs: top,
      reserveEdgeLabels: true,
    });
    const relaidB = await layoutBoxesAndLinesSearch(parsed, undefined, {
      configs: top,
      reserveEdgeLabels: true,
    });
    expect(geom(relaidA)).toBe(geom(relaidB));
    // Every node/edge survives the restricted-pool relayout.
    expect(relaidA.nodes.map((n) => n.label).sort()).toEqual(
      parsed.nodes.map((n) => n.label).sort()
    );
    expect(relaidA.edges).toHaveLength(parsed.edges.length);
  });

  it('full layout pipeline (with the edge-label relayout escalation) is deterministic', async () => {
    const a = await layoutBoxesAndLines(parseBoxesAndLines(LABELED));
    const b = await layoutBoxesAndLines(parseBoxesAndLines(LABELED));
    expect(geom(a)).toBe(geom(b));
  });
});

describe('countSplineCrossings', () => {
  it('counts an X-crossing between two unrelated edges', () => {
    const layout = syntheticLayout(
      [
        { label: 'A', x: 0, y: 50 },
        { label: 'B', x: 200, y: 150 },
        { label: 'C', x: 0, y: 150 },
        { label: 'D', x: 200, y: 50 },
      ],
      [
        {
          source: 'A',
          target: 'B',
          points: [
            { x: 30, y: 50 },
            { x: 170, y: 150 },
          ],
        },
        {
          source: 'C',
          target: 'D',
          points: [
            { x: 30, y: 150 },
            { x: 170, y: 50 },
          ],
        },
      ]
    );
    expect(countSplineCrossings(layout)).toBe(1);
  });

  it('returns 0 for bbox-disjoint edges (AABB pair reject cannot change counts)', () => {
    const layout = syntheticLayout(
      [
        { label: 'A', x: 0, y: 0 },
        { label: 'B', x: 200, y: 0 },
        { label: 'C', x: 0, y: 500 },
        { label: 'D', x: 200, y: 500 },
      ],
      [
        {
          source: 'A',
          target: 'B',
          points: [
            { x: 30, y: 0 },
            { x: 170, y: 0 },
          ],
        },
        {
          source: 'C',
          target: 'D',
          points: [
            { x: 30, y: 500 },
            { x: 170, y: 500 },
          ],
        },
      ]
    );
    expect(countSplineCrossings(layout)).toBe(0);
  });

  it('matches counts on real search output regardless of the floor early-out', async () => {
    const layout = await layoutBoxesAndLinesSearch(parseBoxesAndLines(DENSE));
    const exact = countSplineCrossings(layout);
    expect(countSplineCrossings(layout, Infinity)).toBe(exact);
    // A floor at/above the exact count must not alter the result.
    expect(countSplineCrossings(layout, exact)).toBe(exact);
  });
});

describe('boxes-and-lines collapse-all layout', () => {
  // Two groups plus a couple of bare nodes and cross-group edges. When BOTH
  // groups collapse, `parsed.groups` is empty — which used to make the flat
  // `layeredCandidates` generator kick in, drop the `__group_*` boxes and their
  // incident edges, then win on badness. Every collapsed group must still
  // materialise as a box and keep its cross-group edges.
  const GROUPED = [
    'boxes-and-lines',
    '[Frontend]',
    '  Web',
    '  Mobile',
    '[Backend]',
    '  API',
    '  DB',
    'Web -> API',
    'Mobile -> API',
    'API -> DB',
    'Gateway -> API',
    'Web -> Gateway',
    'Gateway',
  ].join('\n');

  it('materialises every collapsed group as a box and keeps cross-group edges', async () => {
    const parsed = parseBoxesAndLines(GROUPED);
    const all = new Set(parsed.groups.map((g) => g.label));
    const col = collapseBoxesAndLines(parsed, all);
    const layout = await layoutBoxesAndLines(col.parsed, {
      collapsedChildCounts: col.collapsedChildCounts,
      originalGroups: col.originalGroups,
    });

    const collapsed = layout.groups.filter((g) => g.collapsed);
    expect(collapsed.map((g) => g.label).sort()).toEqual([
      'Backend',
      'Frontend',
    ]);
    // Both collapsed boxes carry their direct child count.
    for (const g of collapsed) expect(g.childCount).toBe(2);

    // An edge from the bare Gateway node INTO a collapsed group survives,
    // rerouted to the group placeholder — nothing is silently dropped.
    const toBackend = layout.edges.some(
      (e) => e.target === '__group_Backend' || e.source === '__group_Backend'
    );
    expect(toBackend).toBe(true);
    // The bare node is still present.
    expect(layout.nodes.some((n) => n.label === 'Gateway')).toBe(true);
  });
});

/**
 * The reported OAuth flow, reduced to what makes dagre choke: three groups,
 * long edge labels, `direction-lr`. Reserving a virtual label node per edge is
 * what turns it degenerate — laid out plain it is fine.
 */
const OAUTH_RESERVE_CHOKER = `boxes-and-lines OAuth 2.0 Authorization Code with PKCE
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

describe('the search returns a layout rather than throwing', () => {
  /**
   * 🔴 Regression: dagre's `Not possible to find intersection inside of the
   * rectangle` used to escape the search, so a diagram rendered as an exception.
   *
   * The escape route was the last-resort placement taken when EVERY candidate
   * chokes — the one `place` call that was not wrapped. It is reachable only
   * through the label-reserving relayout, and in the wild only on a busy
   * machine: the first search's wall-clock budget truncates its pool, the
   * layout it settles for leaves a label unresolved, and that is what calls the
   * relayout at all. Loaded, it reproduced 3 of 3 runs on an 8-core Linux box;
   * idle, 0 of 5.
   *
   * `configs: []` is the deterministic form of the same state — an explicitly
   * empty candidate pool lands on the fallback directly, with no dependence on
   * how busy this machine is. That matters more than mimicking the original
   * route: a wall-clock reproduction would measure the machine.
   */
  it('falls back when label reservation chokes every candidate', async () => {
    const parsed = parseBoxesAndLines(OAUTH_RESERVE_CHOKER);

    const layout = await layoutBoxesAndLinesSearch(parsed, undefined, {
      reserveEdgeLabels: true,
      configs: [],
    });

    // A real layout, not an empty shell: every node placed, every edge routed.
    expect(layout.nodes).toHaveLength(parsed.nodes.length);
    expect(layout.edges).toHaveLength(parsed.edges.length);
    for (const n of layout.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }

    // Dropping the reservation is what saves it, so the fallback must land on
    // the unreserved geometry — if this ever diverges, the retry stopped being
    // the thing under test.
    const unreserved = await layoutBoxesAndLinesSearch(parsed, undefined, {
      configs: [],
    });
    expect(geom(layout)).toBe(geom(unreserved));
  });

  it('still reserves label space when the candidates can take it', async () => {
    // The guard must not have turned reservation into a no-op everywhere: on a
    // graph dagre lays out happily, reserving space still changes the geometry.
    const parsed = parseBoxesAndLines(LABELED);

    const reserved = await layoutBoxesAndLinesSearch(parsed, undefined, {
      reserveEdgeLabels: true,
    });
    const plain = await layoutBoxesAndLinesSearch(parsed, undefined, {});
    expect(geom(reserved)).not.toBe(geom(plain));
  });
});
