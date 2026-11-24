import { describe, it, expect } from 'vitest';
import { parseInfra } from '../src/infra/parser';
import { computeInfra } from '../src/infra/compute';
import { normalizeName } from '../src/utils/name-normalize';

// Timeouts and retries on infra connections (diagrammo/diagrammo#1955).

function compute(source: string) {
  const parsed = parseInfra(source);
  expect(parsed.error).toBeNull();
  return computeInfra(parsed);
}

function node(result: ReturnType<typeof compute>, id: string) {
  return result.nodes.find((n) => n.id === normalizeName(id))!;
}

function edge(result: ReturnType<typeof compute>, from: string, to: string) {
  return result.edges.find(
    (e) =>
      e.sourceId === normalizeName(from) && e.targetId === normalizeName(to)
  )!;
}

/** The owner's worked example from the 2026-11-23 decisions. */
function retryStorm(apiProps: string, searchEdgeMeta = '') {
  return `infra

edge
  rps: 1000
  -> API

API
  latency-ms: 30
${apiProps}
  -> Search${searchEdgeMeta}

Search
  max-rps: 1500
  latency-ms: 20
  -> Cache | split: 70%
  -> Elastic | split: 30%

Cache
  latency-ms: 5

Elastic
  latency-ms: 400
`;
}

describe('infra timeouts', () => {
  it('retries send the timed-out share down the same slow branch', () => {
    const r = compute(retryStorm('  timeout-ms: 300\n  retries: 2'));
    expect(node(r, 'Search').computedRps).toBeCloseTo(1600);
    expect(node(r, 'Cache').computedRps).toBeCloseTo(700);
    expect(node(r, 'Elastic').computedRps).toBeCloseTo(900);
    const e = edge(r, 'API', 'Search');
    expect(e.computedRps).toBeCloseTo(1600);
    expect(e.timedOutRps).toBeCloseTo(300);
    expect(e.timeoutMs).toBe(300);
    expect(e.retries).toBe(2);
    // 300 of 1000 time out; the 6.25% Search sheds also hits the healthy 700.
    expect(node(r, 'API').computedAvailability).toBeCloseTo(0.65625, 4);
    expect(r.diagnostics.some((d) => d.type === 'TIMEOUT')).toBe(true);
  });

  it('without retries the slow branch is dropped and nothing is shed', () => {
    const r = compute(retryStorm('  timeout-ms: 300'));
    expect(node(r, 'Search').computedRps).toBeCloseTo(1000);
    expect(node(r, 'Elastic').computedRps).toBeCloseTo(300);
    expect(edge(r, 'API', 'Search').timedOutRps).toBeCloseTo(300);
    expect(node(r, 'API').computedAvailability).toBeCloseTo(0.7, 4);
  });

  it('a split where one branch exceeds the timeout drops exactly that share', () => {
    const r = compute(`infra

edge
  rps: 1000
  -> Gateway

Gateway
  timeout-ms: 100
  -> Fast | split: 80%
  -> Slow | split: 20%

Fast
  latency-ms: 50

Slow
  latency-ms: 150
`);
    expect(edge(r, 'Gateway', 'Fast').timedOutRps).toBe(0);
    expect(edge(r, 'Gateway', 'Slow').timedOutRps).toBeCloseTo(200);
    expect(node(r, 'Gateway').computedAvailability).toBeCloseTo(0.8, 4);
  });

  it('a timeout on the connection overrides the node', () => {
    const r = compute(retryStorm('  timeout-ms: 300', ' | timeout-ms: 500'));
    expect(edge(r, 'API', 'Search').timeoutMs).toBe(500);
    expect(edge(r, 'API', 'Search').timedOutRps).toBe(0);
    expect(node(r, 'API').computedAvailability).toBeCloseTo(1, 4);
  });

  it('retries on the connection override the node', () => {
    const r = compute(
      retryStorm('  timeout-ms: 300\n  retries: 2', ' | retries: 0')
    );
    expect(edge(r, 'API', 'Search').retries).toBe(0);
    expect(node(r, 'Search').computedRps).toBeCloseTo(1000);
  });

  it('a timed-out path takes timeout × attempts, and the caller sees it', () => {
    const r = compute(retryStorm('  timeout-ms: 300\n  retries: 2'));
    // API 30 ms + 300 ms × 3 attempts.
    expect(node(r, 'API').computedLatencyPercentiles.p99).toBe(930);
  });

  it('an inner timeout caps outer latency and charges the loss once', () => {
    const r = compute(`infra

edge
  rps: 1000
  -> API

API
  timeout-ms: 300
  -> Search

Search
  latency-ms: 20
  timeout-ms: 100
  -> Elastic

Elastic
  latency-ms: 400
`);
    // Search waits 100 ms and gives up; API sees 20 + 100 = 120 < 300.
    expect(edge(r, 'Search', 'Elastic').timedOutRps).toBeCloseTo(1000);
    expect(edge(r, 'API', 'Search').timedOutRps).toBe(0);
    expect(node(r, 'API').computedLatencyPercentiles.p50).toBe(120);
    expect(node(r, 'API').computedAvailability).toBe(0);
  });

  it('inner retries multiply outer retries', () => {
    const r = compute(`infra

edge
  rps: 100
  -> A

A
  timeout-ms: 50
  retries: 1
  -> B

B
  timeout-ms: 10
  retries: 2
  -> C

C
  latency-ms: 100
`);
    // B gives up after 10 × 3 = 30 ms < 50, so A never times out.
    expect(edge(r, 'A', 'B').timedOutRps).toBe(0);
    expect(node(r, 'B').computedRps).toBeCloseTo(100);
    expect(node(r, 'C').computedRps).toBeCloseTo(300);
  });

  it('a retry storm cascades when the inner give-up is slower than the outer timeout', () => {
    const r = compute(`infra

edge
  rps: 100
  -> A

A
  timeout-ms: 20
  retries: 1
  -> B

B
  timeout-ms: 10
  retries: 2
  -> C

C
  latency-ms: 100
`);
    // B gives up after 30 ms > 20, so A retries too: 2 attempts × 3 = 6 per request.
    expect(node(r, 'B').computedRps).toBeCloseTo(200);
    expect(node(r, 'C').computedRps).toBeCloseTo(600);
  });
});

describe('infra timeout parsing', () => {
  it('reads timeout-ms and retries from connection metadata', () => {
    const p = parseInfra(retryStorm('', ' timeout-ms: 250, retries: 1'));
    const e = p.edges.find((x) => x.targetId === normalizeName('Search'))!;
    expect(e.timeoutMs).toBe(250);
    expect(e.retries).toBe(1);
    expect(p.diagnostics.filter((d) => d.severity === 'warning')).toEqual([]);
  });

  it('warns and ignores timeout-ms and retries on an async connection', () => {
    const p = parseInfra(`infra

edge
  rps: 100
  -> API

API
  ~> Queue | timeout-ms: 100, retries: 2

Queue
  latency-ms: 5
`);
    const e = p.edges.find((x) => x.async)!;
    expect(e.timeoutMs).toBeNull();
    expect(e.retries).toBeNull();
    const msgs = p.diagnostics.map((d) => d.message).join('\n');
    expect(msgs).toContain("'timeout-ms' has no effect on an async");
    expect(msgs).toContain("'retries' has no effect on an async");
  });

  it('a node timeout does not reach its async connections', () => {
    const r = compute(`infra

edge
  rps: 100
  -> API

API
  timeout-ms: 10
  ~> Worker

Worker
  latency-ms: 500
`);
    expect(r.edges.find((e) => e.async)!.timeoutMs).toBeNull();
    expect(node(r, 'API').computedAvailability).toBeCloseTo(1, 4);
  });

  it('warns on a non-numeric timeout', () => {
    const p = parseInfra(retryStorm('', ' | timeout-ms: soon'));
    expect(p.diagnostics.map((d) => d.message).join('\n')).toContain(
      "'timeout-ms' must be a number"
    );
  });
});
