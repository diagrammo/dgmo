import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseCycle } from '../src/cycle/parser';
import { renderCycle } from '../src/cycle/renderer';
import { getPalette } from '../src/palettes';
import { resolveColor } from '../src/colors';

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
});

const nordLight = getPalette('nord').light;

// The source diagrammo/diagrammo#2218 was reported with.
const PIRATE = `cycle The Pirate Raid Cycle

center CENTER
autonumber

tag type as t
  big green
  small yellow
  tiny red

Scout t:big
  Spot merchant vessels from afar

Pursue t:small
  Raise the colors, trim the sails
`;

function render(src: string, options: Record<string, unknown> = {}): Element {
  const parsed = parseCycle(src, nordLight);
  const container = document.createElement('div');
  document.body.appendChild(container);
  renderCycle(
    container,
    parsed,
    nordLight,
    false,
    undefined,
    {
      width: 800,
      height: 600,
    },
    undefined,
    options
  );
  return container;
}

const hex = (name: string): string => resolveColor(name, nordLight)!;

describe('cycle tag groups — parser', () => {
  it('turns the reported source into two coloured steps and no stray step', () => {
    const r = parseCycle(PIRATE, nordLight);
    expect(r.error).toBeNull();
    expect(r.diagnostics).toEqual([]);
    expect(r.nodes.map((n) => n.label)).toEqual(['Scout', 'Pursue']);
    expect(r.nodes[0]!.description).toEqual([
      'Spot merchant vessels from afar',
    ]);
    expect(r.nodes[0]!.metadata).toEqual({ type: 'big' });
    expect(r.nodes[1]!.metadata).toEqual({ type: 'small' });
    expect(r.tagGroups).toHaveLength(1);
    expect(r.tagGroups[0]!.name).toBe('type');
    expect(r.tagGroups[0]!.alias).toBe('t');
    expect(r.tagGroups[0]!.entries.map((e) => e.value)).toEqual([
      'big',
      'small',
      'tiny',
    ]);
  });

  it('reads `t:big` and `t: big` the same', () => {
    const a = parseCycle(PIRATE, nordLight).nodes[0]!.metadata;
    const b = parseCycle(PIRATE.replace('t:big', 't: big'), nordLight).nodes[0]!
      .metadata;
    expect(b).toEqual(a);
  });

  it('resolves explicit entry colours to hex', () => {
    const g = parseCycle(PIRATE, nordLight).tagGroups[0]!;
    expect(g.entries.map((e) => e.color)).toEqual([
      hex('green'),
      hex('yellow'),
      hex('red'),
    ]);
  });

  it('auto-colours bare values, distinct from each other', () => {
    const r = parseCycle(
      `cycle C

tag Phase as p
  Plan
  Do
  Check

A p: Plan
B p: Do
C p: Check`,
      nordLight
    );
    const colors = r.tagGroups[0]!.entries.map((e) => e.color);
    expect(colors.every((c) => c !== '')).toBe(true);
    expect(new Set(colors).size).toBe(3);
  });

  it('gives an untagged step the first value (the group default)', () => {
    const r = parseCycle(`${PIRATE}\nLoot\n`, nordLight);
    expect(r.nodes[2]!.metadata).toEqual({ type: 'big' });
  });

  it('honours an explicit `default` marker', () => {
    const r = parseCycle(
      PIRATE.replace('small yellow', 'small yellow default') + '\nLoot\n',
      nordLight
    );
    expect(r.nodes[2]!.metadata).toEqual({ type: 'small' });
  });

  it('accepts the inline-values form', () => {
    const r = parseCycle(
      `cycle C

tag Phase as p Plan blue, Do green

A p: Do
B`,
      nordLight
    );
    expect(r.tagGroups[0]!.entries.map((e) => e.value)).toEqual(['Plan', 'Do']);
    expect(r.nodes[0]!.metadata).toEqual({ phase: 'Do' });
  });

  it('keeps a step own colour separate from its tag value', () => {
    const r = parseCycle(
      PIRATE.replace('Scout t:big', 'Scout red t:big'),
      nordLight
    );
    expect(r.nodes[0]!.color).toBe('red');
    expect(r.nodes[0]!.metadata).toEqual({ type: 'big' });
  });

  it('warns on an unknown tag value, with a suggestion', () => {
    const r = parseCycle(PIRATE.replace('t:small', 't:smal1'), nordLight);
    const w = r.diagnostics.find((d) => /Unknown value/.test(d.message));
    expect(w?.severity).toBe('warning');
    expect(w?.line).toBe(14);
  });

  it('warns on an active-tag that names no group', () => {
    const r = parseCycle(
      PIRATE.replace('autonumber', 'autonumber\nactive-tag nope'),
      nordLight
    );
    expect(r.diagnostics.some((d) => d.code === 'W_ACTIVE_TAG_NO_MATCH')).toBe(
      true
    );
  });

  it('errors on a tag block declared after a step', () => {
    const r = parseCycle(
      `cycle C

A
tag Phase as p
  Plan
B`,
      nordLight
    );
    expect(
      r.diagnostics.some((d) => d.code === 'E_TAG_DECLARED_AFTER_CONTENT')
    ).toBe(true);
  });

  it('keeps a capitalised "Tag ..." step a step', () => {
    const r = parseCycle(`cycle C

Tag assets
Ship`);
    expect(r.nodes.map((n) => n.label)).toEqual(['Tag assets', 'Ship']);
    expect(r.tagGroups).toEqual([]);
  });

  it('leaves untagged cycles with no tag groups', () => {
    const r = parseCycle(`cycle C

A
B`);
    expect(r.tagGroups).toEqual([]);
  });
});

describe('cycle tag groups — renderer', () => {
  it('draws the tag legend with every value', () => {
    const c = render(PIRATE);
    const entries = [...c.querySelectorAll('[data-legend-entry]')].map((e) =>
      e.getAttribute('data-legend-entry')
    );
    expect(entries).toEqual(expect.arrayContaining(['big', 'small', 'tiny']));
    expect(c.querySelector('[data-legend-group]')).toBeTruthy();
  });

  it('puts data-tag-<group> on each step', () => {
    const c = render(PIRATE);
    const steps = [...c.querySelectorAll('.cycle-node')];
    expect(steps.map((s) => s.getAttribute('data-tag-type'))).toEqual([
      'big',
      'small',
    ]);
  });

  it('outlines each step in its tag colour', () => {
    const c = render(PIRATE);
    const strokes = [...c.querySelectorAll('.cycle-node rect')].map((r) =>
      r.getAttribute('stroke')
    );
    expect(strokes).toEqual([hex('green'), hex('yellow')]);
  });

  it('lets a step own colour win over its tag colour', () => {
    const c = render(PIRATE.replace('Scout t:big', 'Scout red t:big'));
    const strokes = [...c.querySelectorAll('.cycle-node rect')].map((r) =>
      r.getAttribute('stroke')
    );
    expect(strokes).toEqual([hex('red'), hex('yellow')]);
  });

  it('lets an edge inherit its source step tag colour', () => {
    const c = render(PIRATE);
    const strokes = [...c.querySelectorAll('.cycle-edge path')].map((p) =>
      p.getAttribute('stroke')
    );
    expect(strokes).toEqual([hex('green'), hex('yellow')]);
  });

  it('colours by the group active-tag names, and none turns colour off', () => {
    const two = PIRATE.replace('Scout t:big', 'Scout t:big, r: Fast').replace(
      'tag type as t',
      'tag Speed as r\n  Fast purple\n  Slow orange\n\ntag type as t'
    );
    const first = render(two);
    expect(
      first.querySelectorAll('.cycle-node rect')[0]!.getAttribute('stroke')
    ).toBe(hex('purple'));
    const picked = render(
      two.replace('autonumber', 'autonumber\nactive-tag type')
    );
    expect(
      picked.querySelectorAll('.cycle-node rect')[0]!.getAttribute('stroke')
    ).toBe(hex('green'));
    const none = render(
      two.replace('autonumber', 'autonumber\nactive-tag none')
    );
    expect(
      none.querySelectorAll('.cycle-node rect')[0]!.getAttribute('stroke')
    ).toBe(nordLight.primary);
  });

  it('lets the runtime tag override win', () => {
    const two = PIRATE.replace(
      'tag type as t',
      'tag Speed as r\n  Fast purple\n  Slow orange\n\ntag type as t'
    );
    const c = render(two, { tagOverride: 'type' });
    expect(
      c.querySelectorAll('.cycle-node rect')[0]!.getAttribute('stroke')
    ).toBe(hex('green'));
  });

  it('hides the legend under no-legend, keeping the colours', () => {
    const c = render(PIRATE.replace('autonumber', 'autonumber\nno-legend'));
    expect(c.querySelector('[data-legend-entry]')).toBeNull();
    expect(
      c.querySelectorAll('.cycle-node rect')[0]!.getAttribute('stroke')
    ).toBe(hex('green'));
  });

  it('draws no legend for an untagged cycle', () => {
    const c = render(`cycle C

A
B`);
    expect(c.querySelector('[data-legend-entry]')).toBeNull();
  });
});
