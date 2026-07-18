import { describe, it, expect } from 'vitest';
import { parseOrg } from '../src/org/parser';
import { layoutOrg } from '../src/org/layout';
import { parseC4 } from '../src/c4/parser';
import {
  layoutC4Context,
  layoutC4Containers,
  layoutC4Components,
  layoutC4Deployment,
} from '../src/c4/layout';

// ============================================================
// Decision #48 — `direction-lr` / `direction-tb` on org and c4.
//
// Both charts accepted the booleans long before anything consumed them: org's
// layout was hardcoded top-down and c4 pinned dagre to `rankdir: 'TB'` at four
// sites. These tests pin the real behaviour now that the directive is wired up,
// including a regression guard on the default so an accidental flip fails loudly.
// ============================================================

const ORG_TREE = `Captain
  First Mate
    Bosun
    Cook
  Quartermaster
    Gunner
`;

const orgSrc = (directive: string): string =>
  `org Crew\n${directive ? directive + '\n' : ''}${ORG_TREE}`;

/** Screen extents of the laid-out cards (ignoring canvas margins). */
function orgExtents(directive: string): {
  width: number;
  height: number;
  aspect: number;
  depthByLabel: Map<string, number>;
} {
  const parsed = parseOrg(orgSrc(directive));
  expect(parsed.error).toBeFalsy();
  const layout = layoutOrg(parsed);

  const depthByLabel = new Map<string, number>();
  for (const n of layout.nodes) depthByLabel.set(n.label, n.x);

  return {
    width: layout.width,
    height: layout.height,
    aspect: layout.width / layout.height,
    depthByLabel,
  };
}

describe('org direction (§7.5)', () => {
  it('parses the booleans into a resolved direction', () => {
    expect(parseOrg(orgSrc('direction-lr')).direction).toBe('LR');
    expect(parseOrg(orgSrc('direction-tb')).direction).toBe('TB');
  });

  it('defaults to top-down — org charts have always rendered TB', () => {
    // Regression guard: org has rendered top-down since it shipped. The spec
    // claimed an LR default for a directive that never ran; the code is the
    // source of truth here. Flipping this default silently re-orients every
    // existing diagram, so it must fail loudly.
    expect(parseOrg(orgSrc('')).direction).toBe('TB');
  });

  it('default layout is identical to an explicit direction-tb layout', () => {
    const bare = orgExtents('');
    const tb = orgExtents('direction-tb');
    expect(bare.width).toBe(tb.width);
    expect(bare.height).toBe(tb.height);
    expect([...bare.depthByLabel]).toEqual([...tb.depthByLabel]);
  });

  it('direction-lr produces a genuinely wider-than-tall layout vs TB', () => {
    const lr = orgExtents('direction-lr');
    const tb = orgExtents('direction-tb');

    // Same tree, so a real LR layout must be relatively more landscape.
    expect(lr.aspect).toBeGreaterThan(tb.aspect);
    expect(lr.width).toBeGreaterThan(lr.height);
  });

  it('direction-lr places the root at the left with reports flowing right', () => {
    const lr = orgExtents('direction-lr');
    const captain = lr.depthByLabel.get('Captain')!;
    const firstMate = lr.depthByLabel.get('First Mate')!;
    const bosun = lr.depthByLabel.get('Bosun')!;

    // Depth increases along x: root, then its reports, then theirs.
    expect(captain).toBeLessThan(firstMate);
    expect(firstMate).toBeLessThan(bosun);

    // Siblings share a rank, so they share an x.
    expect(lr.depthByLabel.get('Quartermaster')).toBe(firstMate);
  });

  it('direction-tb places the root on top with reports flowing down', () => {
    const parsed = parseOrg(orgSrc('direction-tb'));
    const layout = layoutOrg(parsed);
    const yOf = (label: string): number =>
      layout.nodes.find((n) => n.label === label)!.y;

    expect(yOf('Captain')).toBeLessThan(yOf('First Mate'));
    expect(yOf('First Mate')).toBeLessThan(yOf('Bosun'));
    // Siblings share a rank.
    expect(yOf('Quartermaster')).toBe(yOf('First Mate'));
  });

  it('honours last-one-wins for the mutually-exclusive pair (§1.9)', () => {
    expect(parseOrg(orgSrc('direction-lr\ndirection-tb')).direction).toBe('TB');
    expect(parseOrg(orgSrc('direction-tb\ndirection-lr')).direction).toBe('LR');
  });

  it('lays containers out without overlap under LR', () => {
    const parsed = parseOrg(
      `org Crew
direction-lr
Captain
  [Deck]
    Bosun
    Cook
  [Guns]
    Gunner
    Powder Monkey
`
    );
    expect(parsed.error).toBeFalsy();
    const layout = layoutOrg(parsed);

    const deck = layout.containers.find((c) => c.label === 'Deck')!;
    const guns = layout.containers.find((c) => c.label === 'Guns')!;
    expect(deck).toBeTruthy();
    expect(guns).toBeTruthy();

    // Sibling containers stack across the cross axis with real clearance —
    // the tree must reserve the label strip, not merely avoid overlapping.
    const [upper, lower] = deck.y < guns.y ? [deck, guns] : [guns, deck];
    expect(lower.y - (upper.y + upper.height)).toBeGreaterThanOrEqual(
      lower.labelHeight
    );

    // Every box stays on-canvas.
    for (const c of layout.containers) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y + c.height).toBeLessThanOrEqual(layout.height);
    }

    // Each container's cards sit inside its box, below the label strip.
    for (const c of layout.containers) {
      const members = layout.nodes.filter(
        (n) =>
          n.label !== c.label &&
          n.x - n.width / 2 >= c.x &&
          n.x + n.width / 2 <= c.x + c.width &&
          n.y >= c.y &&
          n.y + n.height <= c.y + c.height
      );
      expect(members.length).toBeGreaterThan(0);
      for (const m of members) {
        expect(m.y).toBeGreaterThanOrEqual(c.y + c.labelHeight);
      }
    }
  });
});

// ============================================================
// c4 — one dagre-backed layout per view, all four honouring rankdir
// ============================================================

const C4_BODY = `User is a person
  -Uses-> Shop
Shop is a system
  -Charges-> Pay
  -Notifies-> Mail
Pay is a system
Mail is a system
`;

const c4Src = (directive: string): string =>
  `c4 Probe\n${directive ? directive + '\n' : ''}${C4_BODY}`;

describe('c4 direction (§8.7)', () => {
  it('parses the booleans into a resolved direction', () => {
    expect(parseC4(c4Src('direction-lr')).direction).toBe('LR');
    expect(parseC4(c4Src('direction-tb')).direction).toBe('TB');
  });

  it('defaults to top-down — c4 has pinned rankdir TB since it shipped', () => {
    // Regression guard, as above: every historical revision of the c4 layout
    // used `rankdir: 'TB'`. The documented LR default was never implemented.
    expect(parseC4(c4Src('')).direction).toBe('TB');
  });

  it('honours last-one-wins for the mutually-exclusive pair (§1.9)', () => {
    expect(parseC4(c4Src('direction-lr\ndirection-tb')).direction).toBe('TB');
    expect(parseC4(c4Src('direction-tb\ndirection-lr')).direction).toBe('LR');
  });

  it('context view: LR is more landscape than TB, default matches TB', () => {
    const bare = layoutC4Context(parseC4(c4Src('')));
    const tb = layoutC4Context(parseC4(c4Src('direction-tb')));
    const lr = layoutC4Context(parseC4(c4Src('direction-lr')));

    expect(bare.width).toBe(tb.width);
    expect(bare.height).toBe(tb.height);

    expect(lr.width / lr.height).toBeGreaterThan(tb.width / tb.height);
    expect(lr.width).toBeGreaterThan(tb.width);
    expect(lr.height).toBeLessThan(tb.height);
  });

  it('context view: LR ranks advance along x, TB along y', () => {
    const xy = (
      layout: ReturnType<typeof layoutC4Context>,
      name: string
    ): { x: number; y: number } => {
      const n = layout.nodes.find((node) => node.name === name)!;
      return { x: n.x, y: n.y };
    };

    const tb = layoutC4Context(parseC4(c4Src('direction-tb')));
    expect(xy(tb, 'User').y).toBeLessThan(xy(tb, 'Shop').y);
    expect(xy(tb, 'Shop').y).toBeLessThan(xy(tb, 'Pay').y);

    const lr = layoutC4Context(parseC4(c4Src('direction-lr')));
    expect(xy(lr, 'User').x).toBeLessThan(xy(lr, 'Shop').x);
    expect(xy(lr, 'Shop').x).toBeLessThan(xy(lr, 'Pay').x);
  });

  it('container view honours direction', () => {
    const src = (d: string): string =>
      `c4 Probe
${d ? d + '\n' : ''}Shop is a system
  containers
    Web is a container description: Storefront UI
      -Calls-> Api
    Api is a container description: Order API
      -Reads/writes-> Db
    Db is a container is a database description: Order store
`;
    const bare = layoutC4Containers(parseC4(src('')), 'Shop');
    const tb = layoutC4Containers(parseC4(src('direction-tb')), 'Shop');
    const lr = layoutC4Containers(parseC4(src('direction-lr')), 'Shop');

    expect(tb.nodes.length).toBeGreaterThan(0);
    expect(lr.nodes.length).toBe(tb.nodes.length);
    // Default is unchanged from today's rendering.
    expect(bare.width).toBe(tb.width);
    expect(bare.height).toBe(tb.height);
    expect(lr.width / lr.height).toBeGreaterThan(tb.width / tb.height);
  });

  it('component view honours direction', () => {
    const src = (d: string): string =>
      `c4 Probe
${d ? d + '\n' : ''}Shop is a system
  containers
    Api is a container description: Order API
      components
        Ctrl is a component description: REST endpoints
          -Delegates to-> Svc
        Svc is a component description: Business logic
          -Reads/writes-> Repo
        Repo is a component is a database description: Data access
`;
    const bare = layoutC4Components(parseC4(src('')), 'Shop', 'Api');
    const tb = layoutC4Components(parseC4(src('direction-tb')), 'Shop', 'Api');
    const lr = layoutC4Components(parseC4(src('direction-lr')), 'Shop', 'Api');

    expect(tb.nodes.length).toBeGreaterThan(0);
    expect(lr.nodes.length).toBe(tb.nodes.length);
    expect(bare.width).toBe(tb.width);
    expect(bare.height).toBe(tb.height);
    expect(lr.width / lr.height).toBeGreaterThan(tb.width / tb.height);
  });

  it('deployment view honours direction', () => {
    const src = (d: string): string =>
      `c4 Probe
${d ? d + '\n' : ''}Shop is a system
  containers
    Api is a container
      -Reads/writes-> Db
    Db is a container
deployment
  AWS us-east-1
    ECS Cluster
      container Api
    RDS
      container Db
`;
    const bare = layoutC4Deployment(parseC4(src('')));
    const tb = layoutC4Deployment(parseC4(src('direction-tb')));
    const lr = layoutC4Deployment(parseC4(src('direction-lr')));

    expect(tb.nodes.length).toBeGreaterThan(0);
    expect(lr.nodes.length).toBe(tb.nodes.length);
    expect(bare.width).toBe(tb.width);
    expect(bare.height).toBe(tb.height);
    // Deployment nests container refs inside infra parents; the direction still
    // drives how those infra groups rank against one another.
    expect(lr.width / lr.height).toBeGreaterThan(tb.width / tb.height);
  });
});
