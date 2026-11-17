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

// The §27.8 reserved seams were promoted by the BPMN extension (#1874); what
// is left out for now still rejects with E_SWIMLANE_UNSUPPORTED.
describe('swimlane parser — constructs left out for now', () => {
  const cases: Array<[string, string]> = [
    ['(Late) escalation -> Done', 'escalation'],
    ['(Undo) compensation -> Done', 'compensation'],
    ['Foo timer: 5d', 'trailing word'],
  ];
  for (const [token, needle] of cases) {
    it(`rejects ${token} with E_SWIMLANE_UNSUPPORTED`, () => {
      const p = parseSwimlane(`swimlane T
lane L
  Done
  ${token}`);
      const unsupported = p.diagnostics.filter(
        (d) => d.code === 'E_SWIMLANE_UNSUPPORTED'
      );
      expect(unsupported.length).toBeGreaterThan(0);
      expect(unsupported.some((d) => d.message.includes(needle))).toBe(true);
    });
  }

  it('rejects pools combined with [Phase] columns', () => {
    const p = parseSwimlane(`swimlane T
pool P
  lane L
    A -> B
    B
[Start]
  lane L
    C`);
    expect(
      p.diagnostics.some(
        (d) =>
          d.code === 'E_SWIMLANE_UNSUPPORTED' && d.message.includes('[Phase]')
      )
    ).toBe(true);
    expect(p.phases).toHaveLength(0);
  });
});

describe('swimlane parser — BPMN (#1874)', () => {
  const claims = parseSwimlane(FIX('swimlane-bpmn.dgmo'));
  const node = (id: string) => claims.nodes.find((n) => n.id === id)!;

  it('parses the claims process with zero diagnostics', () => {
    expect(claims.diagnostics).toEqual([]);
  });

  it('reads pools, their lanes, and a lane-less outside party', () => {
    expect(claims.pools.map((p) => [p.id, p.lanes])).toEqual([
      ['Customer', []],
      ['Insurer', ['Claims Agent', 'Adjuster', 'Finance']],
    ]);
    expect(claims.lanes.every((l) => l.pool === 'Insurer')).toBe(true);
  });

  it('reads message flow from and to a whole pool', () => {
    expect(claims.messages).toEqual([
      expect.objectContaining({
        source: 'Customer',
        target: 'Claim received',
        sourceIsPool: true,
        targetIsPool: false,
      }),
      expect.objectContaining({
        source: 'Notify customer',
        target: 'Customer',
        sourceIsPool: false,
        targetIsPool: true,
      }),
    ]);
    // Message flow is not sequence flow.
    expect(claims.edges.some((e) => e.target === 'Customer')).toBe(false);
  });

  it('reads event triggers as trailing words', () => {
    expect(node('Claim received').event).toBe('message');
    expect(node('5 days').event).toBe('timer');
    const p = parseSwimlane(`swimlane T
lane L
  (Go) signal -> (Wait) message -> (End) signal`);
    expect(p.nodes.map((n) => n.event)).toEqual([
      'signal',
      'message',
      'signal',
    ]);
    expect(p.diagnostics).toEqual([]);
  });

  it('reads type: as a task marker and never as a tag', () => {
    expect(node('Check policy').taskType).toBe('service');
    expect(node('Adjuster review').taskType).toBe('user');
    expect(node('Notify customer').taskType).toBe('send');
    expect(node('Check policy').tags['type']).toBeUndefined();
  });

  it('flags an unknown type: value and lists the six', () => {
    const p = parseSwimlane(`swimlane T
lane L
  Review type: robot`);
    const d = p.diagnostics.find(
      (x) => x.code === 'E_SWIMLANE_UNKNOWN_TASK_TYPE'
    )!;
    expect(d.message).toContain(
      'user, service, manual, script, send or receive'
    );
  });

  it('attaches an indented event to its task as a boundary event', () => {
    expect(node('5 days').boundaryOf).toBe('Adjuster review');
    expect(
      claims.edges.some((e) => e.source === '5 days' && e.target === 'Escalate')
    ).toBe(true);
    // Not indented → an ordinary event.
    expect(node('Escalated').boundaryOf).toBeUndefined();
  });

  it('makes unlabelled gateways from `as` and resolves lines that point at them', () => {
    expect(node('merge')).toMatchObject({ shape: 'exclusive', label: '' });
    expect(node('split')).toMatchObject({ shape: 'parallel', label: '' });
    expect(node('join')).toMatchObject({ shape: 'parallel', label: '' });
    expect(
      claims.edges.filter((e) => e.target === 'join').map((e) => e.source)
    ).toEqual(['Notify customer', 'Pay claim']);
  });

  it('reads <o …> and <* …> as inclusive and event-based gateways', () => {
    const p = parseSwimlane(`swimlane T
lane L
  A -> <o Which checks?>
  <o Which checks?>
    -> B
  B -> <* Wait for reply>
  <*> as first
  C -> first`);
    expect(p.nodes.find((n) => n.id === 'Which checks?')!.shape).toBe(
      'inclusive'
    );
    expect(p.nodes.find((n) => n.id === 'Wait for reply')!.shape).toBe(
      'event-based'
    );
    expect(p.nodes.find((n) => n.id === 'first')!.shape).toBe('event-based');
  });

  it('flags an unlabelled gateway with no `as` name', () => {
    const p = parseSwimlane(`swimlane T
lane L
  Pay -> <+>`);
    expect(codes(p.diagnostics)).toContain('E_SWIMLANE_UNNAMED_GATEWAY');
  });

  it('attaches store:, data: and note: (a note keeps its commas)', () => {
    expect(node('Check policy').artifacts).toEqual([
      { kind: 'store', label: 'Policy DB' },
    ]);
    expect(node('Auto approve').artifacts).toEqual([
      { kind: 'note', label: 'Under 5k, no person reviews the claim' },
    ]);
    const p = parseSwimlane(`swimlane T
lane L
  Fill form data: Claim form`);
    expect(p.nodes[0]!.artifacts).toEqual([
      { kind: 'data', label: 'Claim form' },
    ]);
  });

  it('rejects ~> inside one pool and names ->', () => {
    const p = parseSwimlane(`swimlane T
pool Insurer
  lane Claims
    Check ~> Pay
    Pay`);
    const d = p.diagnostics.find(
      (x) => x.code === 'E_SWIMLANE_MESSAGE_SAME_POOL'
    )!;
    expect(d.message).toContain("pool 'Insurer'");
    expect(d.message).toContain('use ->');
    expect(p.messages).toHaveLength(0);
  });

  it('rejects ~> in a diagram with no pools', () => {
    const p = parseSwimlane(`swimlane T
lane L
  A ~> B
  B`);
    expect(codes(p.diagnostics)).toContain('E_SWIMLANE_MESSAGE_SAME_POOL');
  });

  it('rejects a node in a lane-less pool', () => {
    const p = parseSwimlane(`swimlane T
pool Customer
  Call -> Hang up`);
    expect(codes(p.diagnostics)).toContain('E_SWIMLANE_COLLAPSED_POOL');
  });

  it('rejects a lane outside every pool once pools exist', () => {
    const p = parseSwimlane(`swimlane T
pool Insurer
  lane Claims
    Check
lane Finance
  Pay`);
    expect(codes(p.diagnostics)).toContain('E_SWIMLANE_LANE_OUTSIDE_POOL');
  });

  it('leaves a diagram with no pool lines as it was', () => {
    const p = parseSwimlane(FIX('swimlane-publishing.dgmo'));
    expect(p.pools).toEqual([]);
    expect(p.messages).toEqual([]);
    expect(p.diagnostics).toEqual([]);
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
