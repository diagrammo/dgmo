import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSwimlane } from '../src/swimlane/parser';

const FIX = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

function codes(diags: { code?: string }[]): string[] {
  return diags.map((d) => d.code ?? '').filter(Boolean);
}

describe('swimlane parser — structure', () => {
  it('parses a 3-deep block (phase ▸ lane ▸ node) with lane + phase on nodes', () => {
    const p = parseSwimlane(FIX('swimlane-insurance.dgmo'));
    expect(p.title).toBe('Insurance Claim');
    expect(p.lanes.map((l) => l.label)).toEqual([
      'Customer',
      'Claims Agent',
      'Adjuster',
      'Payments',
    ]);
    expect(p.phases.map((ph) => ph.label)).toEqual([
      'Submit',
      'Triage',
      'Assess',
      'Settle',
    ]);
    const submit = p.nodes.find((n) => n.id === 'Submit Claim')!;
    expect(submit.lane).toBe('Customer');
    expect(submit.phase).toBe('Submit');
    const fraud = p.nodes.find((n) => n.id === 'Fraud Check')!;
    expect(fraud.lane).toBe('Claims Agent');
    expect(fraud.phase).toBe('Assess');
  });

  it('parses a 2-deep block (lane ▸ node, no phases)', () => {
    const p = parseSwimlane(FIX('swimlane-publishing.dgmo'));
    expect(p.phases).toHaveLength(0);
    expect(p.nodes.find((n) => n.id === 'Draft Post')!.lane).toBe('Writer');
    expect(p.nodes.find((n) => n.id === 'Promote')!.lane).toBe('Social');
  });
});

describe('swimlane parser — node shapes & events (AC4)', () => {
  const p = parseSwimlane(FIX('swimlane-insurance.dgmo'));
  const byId = (id: string) => p.nodes.find((n) => n.id === id)!;

  it('resolves every v1 shape', () => {
    expect(byId('Submit Claim').shape).toBe('task');
    expect(byId('Validate').shape).toBe('exclusive');
    expect(byId('Fork').shape).toBe('parallel');
    expect(byId('Rejected').shape).toBe('terminal');
    expect(byId('Inspect Property').shape).toBe('subprocess');
  });

  it('types terminals: error / success / neutral', () => {
    expect(byId('Rejected').event).toBe('error');
    expect(byId('Denied').event).toBe('error');
    expect(byId('Paid').event).toBe('success');
  });
});

describe('swimlane parser — edges & in-arrow labels (AC5)', () => {
  it('reads the label from inside the arrow, not a trailing word', () => {
    const p = parseSwimlane(`swimlane T
lane L
  <X> -invalid-> B
  B`);
    const e = p.edges.find((x) => x.source === 'X' && x.target === 'B')!;
    expect(e.label).toBe('invalid');
  });

  it('fans out every indented arrow from the group header (not the tail)', () => {
    const p = parseSwimlane(FIX('swimlane-insurance.dgmo'));
    const forkEdges = p.edges.filter((e) => e.source === 'Fork');
    expect(forkEdges.map((e) => e.target).sort()).toEqual(
      ['Assign Adjuster', 'Fraud Check'].sort()
    );
  });

  it('builds a back-edge for a loop', () => {
    const p = parseSwimlane(FIX('swimlane-backedge.dgmo'));
    expect(
      p.edges.some((e) => e.source === 'Check' && e.target === 'Process')
    ).toBe(true);
  });
});

describe('swimlane parser — diagnostics (AC3)', () => {
  it('flags a duplicate node name', () => {
    const p = parseSwimlane(`swimlane T
lane L
L
  Foo
  Foo`);
    expect(codes(p.diagnostics)).toContain('E_SWIMLANE_DUPLICATE_NODE');
  });

  it('flags an edge to an unknown node', () => {
    const p = parseSwimlane(`swimlane T
lane L
  Foo -> Bar`);
    expect(codes(p.diagnostics)).toContain('E_SWIMLANE_UNKNOWN_NODE');
  });
});

describe('swimlane parser — per-token fast-follow rejection (AC12)', () => {
  const cases: Array<[string, string]> = [
    ['<o Maybe>', 'inclusive'],
    ['<* Pick>', 'event-based'],
    ['Foo timer: 5d', 'timer'],
    ['Foo note: hi', 'notes are deferred'],
    ['Foo data: x', 'data objects are deferred'],
  ];
  for (const [token, needle] of cases) {
    it(`rejects ${token} with E_SWIMLANE_UNSUPPORTED`, () => {
      const p = parseSwimlane(`swimlane T
lane L
L
  ${token}`);
      const unsupported = p.diagnostics.filter(
        (d) => d.code === 'E_SWIMLANE_UNSUPPORTED'
      );
      expect(unsupported.length).toBeGreaterThan(0);
      expect(unsupported.some((d) => d.message.includes(needle))).toBe(true);
    });
  }

  it('rejects message flow ~>', () => {
    const p = parseSwimlane(`swimlane T
lane L
L
  A
  B
A ~> B`);
    const u = p.diagnostics.filter((d) => d.code === 'E_SWIMLANE_UNSUPPORTED');
    expect(u.some((d) => d.message.includes('message flow'))).toBe(true);
  });
});

describe('swimlane parser — name/key edge cases (adversarial review)', () => {
  it('keeps a hyphen inside a source node name (not an arrow label)', () => {
    const p = parseSwimlane(`swimlane T
lane L gray
  Read-Write -> Done
  Done`);
    expect(codes(p.diagnostics)).not.toContain('E_SWIMLANE_UNKNOWN_NODE');
    expect(p.edges.map((e) => `${e.source}->${e.target}`)).toContain(
      'Read-Write->Done'
    );
  });

  it('treats an indented line sharing a lane name as a node, not a lane switch', () => {
    const p = parseSwimlane(`swimlane T
lane Review blue
lane Ops gray
Ops
  Review
  Done`);
    const review = p.nodes.find((n) => n.id === 'Review')!;
    expect(review).toBeDefined();
    expect(review.lane).toBe('Ops');
    expect(p.nodes.find((n) => n.id === 'Done')!.lane).toBe('Ops');
  });

  it('reads a multi-word in-arrow label (spaces allowed inside the label)', () => {
    const p = parseSwimlane(`swimlane T
lane L gray
L
  <G>
  Stop
<G> -no ack-> Stop`);
    const e = p.edges.find((x) => x.source === 'G' && x.target === 'Stop')!;
    expect(e.label).toBe('no ack');
  });

  it('makes a node with a trailing color token referenceable in the flow', () => {
    const p = parseSwimlane(`swimlane T
lane L gray
  Charge blue -> Receipt
  Receipt`);
    expect(p.nodes.map((n) => n.id)).toContain('Charge');
    expect(p.edges.map((e) => `${e.source}->${e.target}`)).toContain(
      'Charge->Receipt'
    );
  });

  it('detects a duplicate even when the two share only the base name', () => {
    const p = parseSwimlane(`swimlane T
lane L gray
L
  Pay green
  Pay red`);
    expect(codes(p.diagnostics)).toContain('E_SWIMLANE_DUPLICATE_NODE');
  });
});

describe('swimlane parser — direction & tags', () => {
  it('defaults direction to LR and reads TB', () => {
    expect(parseSwimlane('swimlane T\nlane L').direction).toBe('LR');
    expect(parseSwimlane(FIX('swimlane-tb.dgmo')).direction).toBe('TB');
  });

  it('accepts the direction booleans (canonical, decision #48); last one wins', () => {
    expect(parseSwimlane('swimlane T\ndirection-tb\nlane L').direction).toBe(
      'TB'
    );
    expect(parseSwimlane('swimlane T\ndirection-lr\nlane L').direction).toBe(
      'LR'
    );
    expect(
      parseSwimlane('swimlane T\ndirection-tb\ndirection-lr\nlane L').direction
    ).toBe('LR');
    // Legacy key+value still parses.
    expect(parseSwimlane('swimlane T\ndirection TB\nlane L').direction).toBe(
      'TB'
    );
  });

  it('parses a tag group and applies a node tag value', () => {
    const p = parseSwimlane(FIX('swimlane-insurance.dgmo'));
    expect(p.tagGroups.map((g) => g.name)).toContain('Risk');
    expect(p.nodes.find((n) => n.id === 'Fraud Check')!.tags['risk']).toBe(
      'high'
    );
  });
});
