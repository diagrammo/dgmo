// @vitest-environment jsdom
// #2328 — a static C4 render honours the file's `level` option and colours
// cards by the active tag group at every level.
import { describe, expect, it } from 'vitest';
import { renderForExport } from '../src/d3';
import { parseC4 } from '../src/c4/parser';
import { layoutC4Deployment } from '../src/c4/layout';

const BODY = `tag Tier as t
  Front red
  Back blue

User is a person
  -Uses-> Shop

Shop is a system
  containers
    Web is a container t: Front
      -Calls-> Api
    Api is a container t: Back
      components
        Orders is a component t: Front
          -Writes-> Repo
        Repo is a component t: Back

Bank is a system
  containers
    Ledger is a container t: Back

deployment
  Cloud
    container Web
    container Api
`;

const src = (level?: string) =>
  `c4 Shop\n${level ? `${level}\n` : ''}\n${BODY}`;

function cards(svg: string): Map<string, Element> {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const out = new Map<string, Element>();
  for (const g of doc.querySelectorAll('g.c4-card')) {
    out.set(g.getAttribute('data-node-id')!, g);
  }
  return out;
}

/** The card's own outline colour: its first stroked shape. */
function strokeOf(card: Element): string | null {
  return card.querySelector('[stroke]')?.getAttribute('stroke') ?? null;
}

const levelOf = (level: string) => parseC4(src(level)).level;
const warnings = (level: string) =>
  parseC4(src(level)).diagnostics.filter((d) => d.severity === 'warning');

describe('c4 `level` option — parsing (#2328)', () => {
  it('defaults to context', () => {
    expect(parseC4(src()).level).toEqual({ level: 'context' });
    expect(levelOf('level context')).toEqual({ level: 'context' });
  });

  it('resolves deployment', () => {
    expect(levelOf('level deployment')).toEqual({ level: 'deployment' });
  });

  it('resolves containers of a named system, case-insensitively', () => {
    expect(levelOf('level containers of bank')).toEqual({
      level: 'containers',
      system: 'Bank',
    });
  });

  it('resolves components of a named container to its parent system', () => {
    expect(levelOf('level components of Api')).toEqual({
      level: 'components',
      system: 'Shop',
      container: 'Api',
    });
  });

  it('bare `level components` picks the only container with components', () => {
    expect(levelOf('level components')).toEqual({
      level: 'components',
      system: 'Shop',
      container: 'Api',
    });
  });

  it('bare `level containers` with one candidate picks it', () => {
    const one = parseC4(
      'c4 X\nlevel containers\n\nA is a system\n  containers\n    B is a container\n'
    );
    expect(one.level).toEqual({ level: 'containers', system: 'A' });
    expect(one.diagnostics).toEqual([]);
  });

  it('bare `level containers` with several candidates warns, names them, falls back', () => {
    expect(levelOf('level containers')).toEqual({ level: 'context' });
    const [w] = warnings('level containers');
    expect(w!.message).toContain("'Shop'");
    expect(w!.message).toContain("'Bank'");
    expect(w!.line).toBe(2);
  });

  it('bare `level containers` with no candidate warns and falls back', () => {
    const none = parseC4('c4 X\nlevel containers\n\nA is a system\n');
    expect(none.level).toEqual({ level: 'context' });
    expect(none.diagnostics[0]!.severity).toBe('warning');
  });

  it('an unknown system warns with a suggestion and falls back', () => {
    expect(levelOf('level containers of Shpo')).toEqual({ level: 'context' });
    expect(warnings('level containers of Shpo')[0]!.message).toContain('Shop');
  });

  it('an unknown container warns and falls back', () => {
    expect(levelOf('level components of Nope')).toEqual({ level: 'context' });
    expect(warnings('level components of Nope')).toHaveLength(1);
  });

  it('an unknown level name warns with a suggestion and falls back', () => {
    expect(levelOf('level container')).toEqual({ level: 'context' });
    expect(warnings('level container')[0]!.message).toContain('containers');
  });

  it('`level deployment` without a deployment section warns', () => {
    const p = parseC4('c4 X\nlevel deployment\n\nA is a system\n');
    expect(p.level).toEqual({ level: 'context' });
    expect(p.diagnostics[0]!.severity).toBe('warning');
  });

  it('an element named "level" is still a declaration', () => {
    const p = parseC4('c4 X\n\nlevel is a system\n');
    expect(p.elements.map((e) => e.name)).toEqual(['level']);
    expect(p.options['level']).toBeUndefined();
  });
});

describe('c4 static export draws the file level (#2328)', () => {
  it('no level draws context: people and systems', async () => {
    const ids = [...cards(await renderForExport(src(), 'light')).keys()];
    expect(ids.sort()).toEqual(['Bank', 'Shop', 'User']);
  });

  it('`level containers of Shop` draws Shop’s containers', async () => {
    const ids = [
      ...cards(
        await renderForExport(src('level containers of Shop'), 'light')
      ).keys(),
    ];
    expect(ids).toContain('Web');
    expect(ids).toContain('Api');
    expect(ids).not.toContain('Ledger');
  });

  it('`level components of Api` draws Api’s components', async () => {
    const ids = [
      ...cards(
        await renderForExport(src('level components of Api'), 'light')
      ).keys(),
    ];
    expect(ids).toContain('Orders');
    expect(ids).toContain('Repo');
  });

  it('`level deployment` draws the deployed containers', async () => {
    const ids = [
      ...cards(await renderForExport(src('level deployment'), 'light')).keys(),
    ].sort();
    expect(ids).toEqual(['Api', 'Web']);
  });

  it('an explicit c4Level option still wins over the file', async () => {
    const svg = await renderForExport(
      src('level deployment'),
      'light',
      undefined,
      undefined,
      { c4Level: 'context' }
    );
    expect([...cards(svg).keys()].sort()).toEqual(['Bank', 'Shop', 'User']);
  });
});

describe('c4 static export colours cards by the active tag group (#2328)', () => {
  for (const [level, a, b] of [
    ['level containers of Shop', 'Web', 'Api'],
    ['level components of Api', 'Orders', 'Repo'],
    ['level deployment', 'Web', 'Api'],
  ] as const) {
    it(`${level}: differently tagged cards get different colours`, async () => {
      const c = cards(await renderForExport(src(level), 'light'));
      const sa = strokeOf(c.get(a)!);
      const sb = strokeOf(c.get(b)!);
      expect(sa).toBeTruthy();
      expect(sa).not.toBe(sb);
    });
  }

  it('active-tag none turns the colouring off', async () => {
    const c = cards(
      await renderForExport(
        src('level containers of Shop\nactive-tag none'),
        'light'
      )
    );
    expect(strokeOf(c.get('Web')!)).toBe(strokeOf(c.get('Api')!));
  });
});

describe('edgeless deployment wraps instead of one wide row (#2328)', () => {
  it('lays many unconnected containers out near a landscape card', () => {
    const names = Array.from({ length: 9 }, (_, i) => `C${i}`);
    const text = [
      'c4 X',
      '',
      'S is a system',
      '  containers',
      ...names.map((n) => `    ${n} is a container`),
      '',
      'deployment',
      ...names.flatMap((n) => [`  Node ${n}`, `    container ${n}`]),
    ].join('\n');
    const layout = layoutC4Deployment(parseC4(text));
    expect(layout.nodes).toHaveLength(9);
    const ys = new Set(layout.nodes.map((n) => Math.round(n.y)));
    expect(ys.size).toBeGreaterThan(1);
    const aspect = layout.width / layout.height;
    expect(aspect).toBeGreaterThan(0.8);
    expect(aspect).toBeLessThan(3);
    // No two infra boxes overlap.
    const boxes = layout.groupBoundaries;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const p = boxes[i]!;
        const q = boxes[j]!;
        const overlap =
          p.x < q.x + q.width &&
          q.x < p.x + p.width &&
          p.y < q.y + q.height &&
          q.y < p.y + p.height;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe('direction-lr edges stay attached after crossing reduction (#2328)', () => {
  it('every edge starts on its source card and ends on its target card', async () => {
    const { layoutC4Context } = await import('../src/c4/layout');
    const text = `c4 Harbor
direction-lr

Harbormaster is a person
  description: Assigns berths and settles harbor tolls
  -Schedules berths using-> Harbor Authority
  -Reviews toll receipts in-> Harbor Authority
Ship Captain is a person
  description: Requests moorings and files cargo manifests
  -Files cargo manifests via-> Harbor Authority
Customs Officer is a person
  description: Inspects cargo and assesses duties on incoming loot
  -Inspects manifests through-> Harbor Authority
Harbor Authority is a system
  description: Manages berth scheduling, cargo manifests, and toll collection for the port
  -Fetches tide and squall forecasts from [HTTPS]-> Tide Almanac
  -Settles doubloon tolls through [REST]-> Coin Exchange
  ~Dispatches berth and duty notices via~> Pigeon Post
Tide Almanac is a system is an external
  description: Third-party tide tables and storm forecasts
Coin Exchange is a system is an external
  description: Clearing house that settles doubloon payments between crews
Pigeon Post is a system is an external
  description: Carrier-pigeon dispatch service for harbor notices
`;
    const layout = layoutC4Context(parseC4(text));
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    const on = (p: { x: number; y: number }, id: string) => {
      const n = byId.get(id)!;
      return (
        Math.abs(p.x - n.x) <= n.width / 2 + 2 &&
        Math.abs(p.y - n.y) <= n.height / 2 + 2
      );
    };
    expect(layout.edges.length).toBeGreaterThan(3);
    for (const e of layout.edges) {
      expect(on(e.points[0]!, e.source)).toBe(true);
      expect(on(e.points[e.points.length - 1]!, e.target)).toBe(true);
    }
  });
});
