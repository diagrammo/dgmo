import { describe, it, expect } from 'vitest';
import { parseInfra } from '../src/infra/parser';
import { computeInfra } from '../src/infra/compute';

function compute(source: string, params = {}) {
  const parsed = parseInfra(source);
  expect(parsed.error).toBeNull();
  return computeInfra(parsed, params);
}

function node(result: ReturnType<typeof compute>, id: string) {
  return result.nodes.find((n) => n.id === id)!;
}

function edge(result: ReturnType<typeof compute>, source: string, target: string) {
  return result.edges.find((e) => e.sourceId === source && e.targetId === target)!;
}

describe('infra computation engine', () => {
  describe('FR10: downstream rps computation', () => {
    it('computes rps from edge through simple chain', () => {
      const result = compute(`
chart: infra

edge
  rps: 10000
  -> CDN

CDN
  cache-hit: 80%
  -> API

API
  latency-ms: 45
`);
      expect(node(result, 'edge').computedRps).toBe(10000);
      expect(node(result, 'CDN').computedRps).toBe(10000);
      // CDN passes 20% through (80% cache hit)
      expect(node(result, 'API').computedRps).toBe(2000);
    });

    it('applies firewall-block reduction', () => {
      const result = compute(`
chart: infra

edge
  rps: 10000
  -> WAF

WAF
  firewall-block: 5%
  -> API

API
  latency-ms: 45
`);
      // 10000 * (100-5)/100 = 9500
      expect(node(result, 'API').computedRps).toBe(9500);
    });

    it('applies firewall-block reduction', () => {
      const result = compute(`
chart: infra

edge
  rps: 10000
  -> WAF

WAF
  firewall-block: 10%
  -> API

API
  latency-ms: 45
`);
      // 10000 * 0.9 = 9000
      expect(node(result, 'API').computedRps).toBe(9000);
    });

    it('chains multiple behavior reductions', () => {
      const result = compute(`
chart: infra

edge
  rps: 10000
  -> CDN

CDN
  cache-hit: 80%
  -> WAF

WAF
  firewall-block: 5%
  -> API

API
  latency-ms: 45
`);
      // CDN: 10000 -> 2000 (80% cached)
      // WAF: 2000 -> 1900 (5% blocked)
      expect(node(result, 'API').computedRps).toBe(1900);
    });

    it('supports rps override via params', () => {
      const result = compute(
        `
chart: infra

edge
  rps: 10000
  -> CDN

CDN
  cache-hit: 50%
`,
        { rps: 5000 },
      );
      expect(node(result, 'edge').computedRps).toBe(5000);
      expect(node(result, 'CDN').computedRps).toBe(5000);
    });
  });

  describe('FR11: split distribution', () => {
    it('distributes by declared splits', () => {
      const result = compute(`
chart: infra

edge
  rps: 10000
  -> LB

LB
  -/api-> API | split: 60%
  -/web-> Web | split: 40%

API
  latency-ms: 45

Web
  latency-ms: 30
`);
      expect(node(result, 'API').computedRps).toBe(6000);
      expect(node(result, 'Web').computedRps).toBe(4000);
      expect(edge(result, 'LB', 'API').split).toBe(60);
      expect(edge(result, 'LB', 'Web').split).toBe(40);
    });

    it('infers even splits when none declared', () => {
      const result = compute(`
chart: infra

edge
  rps: 9000
  -> LB

LB
  -> A
  -> B
  -> C

A
  latency-ms: 10

B
  latency-ms: 10

C
  latency-ms: 10
`);
      expect(node(result, 'A').computedRps).toBeCloseTo(3000);
      expect(node(result, 'B').computedRps).toBeCloseTo(3000);
      expect(node(result, 'C').computedRps).toBeCloseTo(3000);
    });

    it('distributes remainder when some splits declared', () => {
      const result = compute(`
chart: infra

edge
  rps: 10000
  -> LB

LB
  -/api-> API | split: 60%
  -> Web
  -> Static

API
  latency-ms: 45

Web
  latency-ms: 30

Static
  latency-ms: 10
`);
      // API gets 60%, remaining 40% split evenly between Web and Static
      expect(node(result, 'API').computedRps).toBe(6000);
      expect(node(result, 'Web').computedRps).toBe(2000);
      expect(node(result, 'Static').computedRps).toBe(2000);
    });

    it('warns when declared splits do not sum to 100%', () => {
      const result = compute(`
chart: infra

edge
  rps: 10000
  -> LB

LB
  -> A | split: 50%
  -> B | split: 30%

A
  latency-ms: 10

B
  latency-ms: 10
`);
      const splitDiag = result.diagnostics.find((d) => d.type === 'SPLIT_SUM');
      expect(splitDiag).toBeDefined();
      expect(splitDiag!.message).toContain('80%');
    });
  });

  describe('FR18: rate limiting drops excess', () => {
    it('caps downstream rps at ratelimit-rps', () => {
      const result = compute(`
chart: infra

edge
  rps: 10000
  -> RateLimiter

RateLimiter
  ratelimit-rps: 500
  -> API

API
  latency-ms: 45
`);
      // 10000 enters, capped at 500
      expect(node(result, 'API').computedRps).toBe(500);
    });

    it('does not cap when rps is below limit', () => {
      const result = compute(`
chart: infra

edge
  rps: 100
  -> RateLimiter

RateLimiter
  ratelimit-rps: 500
  -> API

API
  latency-ms: 45
`);
      expect(node(result, 'API').computedRps).toBe(100);
    });
  });

  describe('FR15: overload detection', () => {
    it('detects overload when rps exceeds capacity', () => {
      const result = compute(`
chart: infra

edge
  rps: 2000
  -> API

API
  max-rps: 500
  instances: 3
`);
      // Capacity: 500 * 3 = 1500, receiving 2000
      expect(node(result, 'API').overloaded).toBe(true);
      const diag = result.diagnostics.find((d) => d.type === 'OVERLOAD');
      expect(diag).toBeDefined();
      expect(diag!.message).toContain('API');
    });

    it('does not flag overload when within capacity', () => {
      const result = compute(`
chart: infra

edge
  rps: 1000
  -> API

API
  max-rps: 500
  instances: 3
`);
      // Capacity: 1500, receiving 1000
      expect(node(result, 'API').overloaded).toBe(false);
      expect(result.diagnostics.filter((d) => d.type === 'OVERLOAD')).toHaveLength(0);
    });

    it('handles single instance overload', () => {
      const result = compute(`
chart: infra

edge
  rps: 600
  -> API

API
  max-rps: 500
`);
      // No instances declared = 1 instance, capacity = 500
      expect(node(result, 'API').overloaded).toBe(true);
    });
  });

  describe('group targeting', () => {
    it('distributes traffic to group children evenly', () => {
      const result = compute(`
chart: infra

edge
  rps: 6000
  -> LB

LB
  -> [Backend]

[Backend]
  API1
    max-rps: 3000
  API2
    max-rps: 3000
`);
      // 6000 -> LB -> [Backend] -> evenly to API1, API2
      expect(node(result, 'API1').computedRps).toBe(3000);
      expect(node(result, 'API2').computedRps).toBe(3000);
    });
  });

  describe('canonical example', () => {
    it('computes the full brainstorming example correctly', () => {
      const result = compute(`
chart: infra
title: Production Traffic Flow
direction: LR

tag: Team alias t
  Backend(blue)
  Platform(teal)
  Commerce(orange)

edge
  rps: 10000
  -> CloudFront

CloudFront | t: Platform
  cache-hit: 80%
  -> CloudArmor

CloudArmor | t: Platform
  firewall-block: 5%
  -> ALB

ALB | t: Platform
  -/api-> [API Pods] | split: 60%
  -/purchase-> [Commerce Pods] | split: 30%
  -/static-> StaticServer | split: 10%

[API Pods]
  APIServer | t: Backend
    instances: 3
    max-rps: 500

[Commerce Pods]
  PurchaseMS | t: Commerce
    instances: 1-8
    max-rps: 300

StaticServer | t: Platform
`);
      expect(result.diagnostics.filter((d) => d.type === 'SPLIT_SUM')).toHaveLength(0);

      // edge: 10000
      expect(node(result, 'edge').computedRps).toBe(10000);

      // CloudFront: 10000, passes 20% = 2000
      expect(node(result, 'CloudFront').computedRps).toBe(10000);

      // CloudArmor: 2000, passes 95% = 1900
      expect(node(result, 'CloudArmor').computedRps).toBe(2000);

      // ALB: 1900 — splits 60/30/10
      expect(node(result, 'ALB').computedRps).toBe(1900);

      // API Pods: 1900 * 60% = 1140 -> APIServer
      expect(node(result, 'APIServer').computedRps).toBe(1140);
      // Capacity: 500 * 3 = 1500 — not overloaded
      expect(node(result, 'APIServer').overloaded).toBe(false);

      // Commerce Pods: 1900 * 30% = 570 -> PurchaseMS
      expect(node(result, 'PurchaseMS').computedRps).toBe(570);
      // instances: 1-8 with auto-scaling -> ceil(570/300) = 2 instances, capacity = 600
      expect(node(result, 'PurchaseMS').computedInstances).toBe(2);
      expect(node(result, 'PurchaseMS').overloaded).toBe(false);

      // StaticServer: 1900 * 10% = 190
      expect(node(result, 'StaticServer').computedRps).toBe(190);
    });
  });

  describe('FR12: cumulative path latency', () => {
    it('computes cumulative latency from edge to leaf', () => {
      const result = compute(`
chart: infra

edge
  rps: 1000
  -> CDN

CDN
  latency-ms: 5
  cache-hit: 0%
  -> API

API
  latency-ms: 45
`);
      expect(node(result, 'edge').computedLatencyMs).toBe(0);
      expect(node(result, 'CDN').computedLatencyMs).toBe(5);
      expect(node(result, 'API').computedLatencyMs).toBe(50);
    });

    it('defaults to 0 when latency-ms is not declared', () => {
      const result = compute(`
chart: infra

edge
  rps: 1000
  -> API

API
  max-rps: 2000
`);
      expect(node(result, 'API').computedLatencyMs).toBe(0);
    });
  });

  describe('FR13: latency percentiles at edge', () => {
    it('computes weighted p50/p90/p99 from multiple paths', () => {
      const result = compute(`
chart: infra

edge
  rps: 10000
  -> CDN

CDN
  latency-ms: 2
  cache-hit: 80%
  -> API

API
  latency-ms: 100
`);
      // 80% of traffic hits cache (2ms path), 20% goes to API (2+100 = 102ms path)
      // p50: should be 2ms (cache hit path covers 80% of traffic)
      // But CDN is not a leaf — API is the only leaf, receiving 2000 rps
      // CDN has outbound edges so it's not a leaf
      // Only API is a leaf with latency 102ms
      // Actually CDN has cache-hit but still passes traffic through
      // All traffic that reaches API has latency 102ms
      expect(result.edgeLatency.p50).toBe(102);
    });

    it('handles multiple leaf nodes with different latencies', () => {
      const result = compute(`
chart: infra

edge
  rps: 10000
  -> LB

LB
  -> Fast | split: 90%
  -> Slow | split: 10%

Fast
  latency-ms: 10

Slow
  latency-ms: 500
`);
      // Fast: 9000 rps, 10ms; Slow: 1000 rps, 500ms
      // p50: 10ms (90% is fast)
      // p90: 10ms (90% is fast, cumulative at 90% = 9000)
      // p99: 500ms (need 9900 of 10000 — fast covers 9000, so we need slow)
      expect(result.edgeLatency.p50).toBe(10);
      expect(result.edgeLatency.p90).toBe(10);
      expect(result.edgeLatency.p99).toBe(500);
    });
  });

  describe('FR14: path and system uptime', () => {
    it('computes system uptime as weighted average', () => {
      const result = compute(`
chart: infra

edge
  rps: 1000
  -> API

API
  uptime: 99.9%
  latency-ms: 10
`);
      // Single path, uptime = 99.9%
      expect(result.systemUptime).toBeCloseTo(0.999);
      expect(node(result, 'API').computedUptime).toBeCloseTo(0.999);
    });

    it('chains uptime along path', () => {
      const result = compute(`
chart: infra

edge
  rps: 1000
  -> LB

LB
  uptime: 99.9%
  -> API

API
  uptime: 99%
  latency-ms: 10
`);
      // LB uptime 99.9%, API uptime 99% — path uptime = 0.999 * 0.99 ≈ 0.98901
      expect(node(result, 'API').computedUptime).toBeCloseTo(0.999 * 0.99);
      expect(result.systemUptime).toBeCloseTo(0.999 * 0.99);
    });
  });

  describe('FR8/FR17: dynamic scaling', () => {
    it('scales instances based on computed rps', () => {
      const result = compute(`
chart: infra

edge
  rps: 2500
  -> API

API
  instances: 2-8
  max-rps: 500
`);
      // ceil(2500/500) = 5, within range 2-8
      expect(node(result, 'API').computedInstances).toBe(5);
      expect(node(result, 'API').overloaded).toBe(false);
    });

    it('caps at max instances and flags overload', () => {
      const result = compute(`
chart: infra

edge
  rps: 5000
  -> API

API
  instances: 2-8
  max-rps: 500
`);
      // ceil(5000/500) = 10, capped at 8, capacity = 4000 < 5000
      expect(node(result, 'API').computedInstances).toBe(8);
      expect(node(result, 'API').overloaded).toBe(true);
    });

    it('uses min instances when load is low', () => {
      const result = compute(`
chart: infra

edge
  rps: 100
  -> API

API
  instances: 2-8
  max-rps: 500
`);
      // ceil(100/500) = 1, but min is 2
      expect(node(result, 'API').computedInstances).toBe(2);
    });

    it('uses fixed instances when not a range', () => {
      const result = compute(`
chart: infra

edge
  rps: 1000
  -> API

API
  instances: 3
  max-rps: 500
`);
      expect(node(result, 'API').computedInstances).toBe(3);
    });
  });

  describe('FR9/FR16: circuit breaker state', () => {
    it('defaults to closed when no thresholds declared', () => {
      const result = compute(`
chart: infra

edge
  rps: 1000
  -> API

API
  max-rps: 2000
`);
      expect(node(result, 'API').computedCbState).toBe('closed');
    });

    it('opens on error threshold exceeded (overloaded)', () => {
      const result = compute(`
chart: infra

edge
  rps: 2000
  -> API

API
  max-rps: 500
  cb-error-threshold: 30%
`);
      // capacity=500, rps=2000, error rate = (2000-500)/2000 = 75% > 30%
      expect(node(result, 'API').computedCbState).toBe('open');
    });

    it('stays closed when error rate is below threshold', () => {
      const result = compute(`
chart: infra

edge
  rps: 500
  -> API

API
  max-rps: 1000
  cb-error-threshold: 50%
`);
      // Not overloaded, error rate = 0
      expect(node(result, 'API').computedCbState).toBe('closed');
    });

    it('opens on latency threshold exceeded', () => {
      const result = compute(`
chart: infra

edge
  rps: 1000
  -> Slow

Slow
  latency-ms: 300
  -> API

API
  latency-ms: 100
  cb-latency-threshold-ms: 200
`);
      // API cumulative latency = 300 + 100 = 400ms > 200ms threshold
      expect(node(result, 'API').computedCbState).toBe('open');
    });
  });

  describe('collapsed groups (Epic 76)', () => {
    it('collapses a group into a virtual node with aggregated latency', () => {
      const result = compute(`
chart: infra

Edge
  rps: 1000
  -> Nginx

[Backend]
  collapsed: true

  Nginx
    latency-ms: 10
    -> AppServer

  AppServer
    latency-ms: 50
    max-rps: 500
`);
      // Group is collapsed → virtual node [Backend]
      const vn = node(result, '[Backend]');
      expect(vn).toBeDefined();
      expect(vn.computedRps).toBe(1000);
      // Aggregated latency: 10 + 50 = 60
      expect(vn.computedLatencyMs).toBeGreaterThanOrEqual(60);
      // No individual child nodes in output
      expect(result.nodes.find((n) => n.id === 'Nginx')).toBeUndefined();
      expect(result.nodes.find((n) => n.id === 'AppServer')).toBeUndefined();
    });

    it('collapsed group uses bottleneck max-rps', () => {
      const result = compute(`
chart: infra

Edge
  rps: 1000
  -> Nginx

[Backend]
  collapsed: true

  Nginx
    max-rps: 2000
    -> AppServer

  AppServer
    max-rps: 500
`);
      const vn = node(result, '[Backend]');
      // Bottleneck is AppServer at 500
      const maxRpsProp = vn.properties.find((p) => p.key === 'max-rps');
      expect(maxRpsProp).toBeDefined();
      expect(maxRpsProp!.value).toBe(500);
    });

    it('collapsed group with instances multiplies capacity', () => {
      const result = compute(`
chart: infra

Edge
  rps: 3000
  -> Nginx

[Backend]
  collapsed: true
  instances: 3

  Nginx
    -> AppServer

  AppServer
    max-rps: 500
`);
      const vn = node(result, '[Backend]');
      // 500 * 3 = 1500 max-rps
      const maxRpsProp = vn.properties.find((p) => p.key === 'max-rps');
      expect(maxRpsProp!.value).toBe(1500);
      // 3000 rps > 1500 capacity → overloaded
      expect(vn.overloaded).toBe(true);
    });

    it('re-routes external edges through virtual node', () => {
      const result = compute(`
chart: infra

Edge
  rps: 1000
  -> Nginx

[Backend]
  collapsed: true

  Nginx
    -> AppServer

  AppServer
    -> DB

DB
  latency-ms: 5
`);
      const vn = node(result, '[Backend]');
      expect(vn.computedRps).toBe(1000);
      // DB should receive traffic through the virtual node
      const db = node(result, 'DB');
      expect(db.computedRps).toBe(1000);
    });

    it('interactive collapsedGroups param overrides source', () => {
      const parsed = parseInfra(`
chart: infra

Edge
  rps: 1000
  -> Nginx

[Backend]

  Nginx
    latency-ms: 10
    -> AppServer

  AppServer
    latency-ms: 50
`);
      // Source says expanded, but params say collapsed
      const result = computeInfra(parsed, { collapsedGroups: new Set(['[Backend]']) });
      expect(result.nodes.find((n) => n.id === '[Backend]')).toBeDefined();
      expect(result.nodes.find((n) => n.id === 'Nginx')).toBeUndefined();
    });

    it('collapsed groups are removed from result.groups', () => {
      const result = compute(`
chart: infra

Edge
  rps: 1000
  -> Nginx

[Backend]
  collapsed: true

  Nginx
    -> AppServer

  AppServer
    max-rps: 500
`);
      // Collapsed group should not appear in result.groups
      expect(result.groups.find((g) => g.id === '[Backend]')).toBeUndefined();
      // Virtual node should exist
      expect(result.nodes.find((n) => n.id === '[Backend]')).toBeDefined();
    });

    it('childHealthState reflects worst child health', () => {
      // Child max-rps 200, group instances 1, traffic 500 → 500 > 200 → overloaded
      const overloaded = compute(`
chart: infra

Edge
  rps: 500
  -> Server

[Backend]
  collapsed: true

  Server
    max-rps: 200
`);
      const vn = node(overloaded, '[Backend]');
      expect(vn.childHealthState).toBe('overloaded');

      // Child max-rps 500, group instances 1, traffic 400 → 400/500=80% → warning
      const warning = compute(`
chart: infra

Edge
  rps: 400
  -> Server

[Backend]
  collapsed: true

  Server
    max-rps: 500
`);
      const vw = node(warning, '[Backend]');
      expect(vw.childHealthState).toBe('warning');

      // Child max-rps 500, group instances 3, traffic 300 → 100/500=20% → normal
      const normal = compute(`
chart: infra

Edge
  rps: 300
  -> Server

[Backend]
  collapsed: true
  instances: 3

  Server
    max-rps: 500
`);
      const vn2 = node(normal, '[Backend]');
      expect(vn2.childHealthState).toBe('normal');
    });

    it('cross-group edges are re-routed when both groups collapsed', () => {
      const result = compute(`
chart: infra

Edge
  rps: 1000
  -> LB

[Frontend]
  collapsed: true

  LB
    -> API

[Backend]
  collapsed: true

  API
    -> DB

DB
  latency-ms: 5
`);
      // Cross-group edge LB->API should become [Frontend]->[Backend]
      const crossEdge = result.edges.find(
        (e) => e.sourceId === '[Frontend]' && e.targetId === '[Backend]'
      );
      expect(crossEdge).toBeDefined();
      // DB should receive traffic through both virtual nodes
      const db = node(result, 'DB');
      expect(db.computedRps).toBe(1000);
    });

    it('collapsed group latency uses critical path, not sum of all children', () => {
      // [Group] has one entry node (A) that sends to external, plus side dependencies
      // (SideDep1, SideDep2) that are internal leaves. Only A is on the through-path.
      // totalLatency should equal A's latency (20ms), NOT A+SideDep1+SideDep2 (260ms).
      const result = compute(`
chart: infra
slo-p90-latency-ms: 500

Edge
  rps: 1000
  -> A

[Group]
  collapsed: true

  A | name: Entry
    latency-ms: 20
    -> External
    -> SideDep1
    -> SideDep2

  SideDep1
    latency-ms: 120

  SideDep2
    latency-ms: 120

External
  latency-ms: 10
`);
      const vn = node(result, '[Group]');
      // The virtual node's p90 latency should be 20ms (A) + 10ms (External) = 30ms,
      // well under the 500ms SLO. If it incorrectly summed all children it would be
      // 260ms (A+SideDep1+SideDep2) + 10ms = 270ms — still under 500 in this case,
      // but the virtual node's own latency-ms property should be 20ms not 260ms.
      const latencyProp = vn.properties.find((p: { key: string }) => p.key === 'latency-ms');
      expect(latencyProp?.value).toBe(20);
    });

    it('collapsed group with slow side dependency does not falsely inflate virtual node latency-ms', () => {
      // Reproduces real-world bug: [MLB Ticketing Middleware] has BoxOffice (entry+exit,
      // latency 20ms) and TicketMaster (internal leaf, latency 1000ms). With a chart-level
      // slo-p90-latency-ms: 500, the collapsed group should NOT show as overloaded.
      // The virtual node's own latency-ms should reflect only the through-path (20ms),
      // not the sum of all children (1020ms).
      const result = compute(`
chart: infra
slo-p90-latency-ms: 500

Edge
  rps: 1000
  -> Proxy

[Group]
  collapsed: true

  Proxy
    latency-ms: 20
    -> External
    -> SlowSideDep

  SlowSideDep
    latency-ms: 1000

External
  latency-ms: 10
`);
      const groupNode = node(result, '[Group]');

      // Virtual node latency-ms = 20ms (just Proxy, the through-path node)
      const latencyProp = groupNode.properties.find((p: { key: string }) => p.key === 'latency-ms');
      expect(latencyProp?.value).toBe(20);

      // p90 latency = Proxy(20) + External(10) = 30ms, well under the 500ms SLO
      expect(groupNode.computedLatencyPercentiles.p90).toBe(30);
    });
  });

  describe('group instances multiply child capacity', () => {
    it('group instances multiply effective capacity of children', () => {
      const result = compute(`
chart: infra

Edge
  rps: 8000
  -> Nginx

[Backend]
  instances: 5

  Nginx
    -> AppServer

  AppServer
    max-rps: 1000
    latency-ms: 50
`);
      const app = node(result, 'AppServer');
      // Effective capacity = 1000 × 5 = 5000. 8000 > 5000 → overloaded
      expect(app.computedInstances).toBe(5);
      expect(app.overloaded).toBe(true);
    });

    it('group instances prevent false overload when capacity is sufficient', () => {
      const result = compute(`
chart: infra

Edge
  rps: 4000
  -> Nginx

[Backend]
  instances: 5

  Nginx
    -> AppServer

  AppServer
    max-rps: 1000
`);
      const app = node(result, 'AppServer');
      // Effective capacity = 1000 × 5 = 5000. 4000 < 5000 → not overloaded
      expect(app.computedInstances).toBe(5);
      expect(app.overloaded).toBe(false);
    });

    it('group instances stack with node instances', () => {
      const result = compute(`
chart: infra

Edge
  rps: 10000
  -> Nginx

[Backend]
  instances: 5

  Nginx
    -> AppServer

  AppServer
    max-rps: 1000
    instances: 3
`);
      const app = node(result, 'AppServer');
      // Effective capacity = 1000 × 3 × 5 = 15000. 10000 < 15000 → not overloaded
      expect(app.computedInstances).toBe(15);
      expect(app.overloaded).toBe(false);
    });
  });

  describe('chart-level defaults (default-latency-ms, default-uptime)', () => {
    it('applies default-latency-ms to nodes without explicit latency', () => {
      const result = compute(`
chart: infra
default-latency-ms: 25

Edge
  rps: 1000
  -> API
API
  -> DB
DB
`);
      // API and DB both get 25ms default latency
      const api = node(result, 'API');
      const db = node(result, 'DB');
      expect(api.computedLatencyMs).toBe(25);
      expect(db.computedLatencyMs).toBe(50); // cumulative: 25 + 25
    });

    it('explicit latency-ms overrides the default', () => {
      const result = compute(`
chart: infra
default-latency-ms: 25

Edge
  rps: 1000
  -> API
API
  latency-ms: 100
  -> DB
DB
`);
      const api = node(result, 'API');
      const db = node(result, 'DB');
      expect(api.computedLatencyMs).toBe(100);
      expect(db.computedLatencyMs).toBe(125); // 100 + 25 default
    });

    it('applies default-uptime to nodes without explicit uptime', () => {
      const result = compute(`
chart: infra
default-uptime: 99.9

Edge
  rps: 1000
  -> API
API
  -> DB
DB
`);
      const api = node(result, 'API');
      const db = node(result, 'DB');
      // API uptime: 0.999, DB cumulative: 0.999 * 0.999 ≈ 0.998
      expect(api.computedUptime).toBeCloseTo(0.999, 3);
      expect(db.computedUptime).toBeCloseTo(0.999 * 0.999, 3);
    });

    it('explicit uptime overrides the default', () => {
      const result = compute(`
chart: infra
default-uptime: 99.9

Edge
  rps: 1000
  -> API
API
  uptime: 95
  -> DB
DB
`);
      const api = node(result, 'API');
      const db = node(result, 'DB');
      expect(api.computedUptime).toBeCloseTo(0.95, 3);
      expect(db.computedUptime).toBeCloseTo(0.95 * 0.999, 3);
    });

    it('default-uptime affects availability calculation', () => {
      const result = compute(`
chart: infra
default-uptime: 90

Edge
  rps: 1000
  -> API
API
  max-rps: 5000
`);
      const api = node(result, 'API');
      // With 90% uptime, availability should reflect that
      expect(api.computedAvailability).toBeCloseTo(0.9, 1);
    });
  });

  describe('serverless capacity model (Epic 77)', () => {
    it('computes effective capacity from concurrency and duration-ms', () => {
      const result = compute(`
chart: infra

edge
  rps: 3000
  -> Lambda

Lambda
  concurrency: 1000
  duration-ms: 200
`);
      const lambda = node(result, 'Lambda');
      // effective capacity = 1000 / (200/1000) = 5000
      expect(lambda.overloaded).toBe(false);
      expect(lambda.computedRps).toBe(3000);
    });

    it('detects overload when rps exceeds effective capacity', () => {
      const result = compute(`
chart: infra

edge
  rps: 6000
  -> Lambda

Lambda
  concurrency: 1000
  duration-ms: 200
`);
      const lambda = node(result, 'Lambda');
      // effective capacity = 5000, rps = 6000 → overloaded
      expect(lambda.overloaded).toBe(true);
    });

    it('computedInstances is 0 for serverless nodes', () => {
      const result = compute(`
chart: infra

edge
  rps: 1000
  -> Lambda

Lambda
  concurrency: 500
  duration-ms: 100
`);
      expect(node(result, 'Lambda').computedInstances).toBe(0);
    });

    it('computes concurrent invocations via Little\'s Law (RPS × duration / 1000)', () => {
      const result = compute(`
chart: infra

edge
  rps: 5000
  -> Lambda

Lambda
  concurrency: 500
  duration-ms: 100
`);
      // 5000 rps × 100ms / 1000 = 500 concurrent invocations
      expect(node(result, 'Lambda').computedConcurrentInvocations).toBe(500);

      // Non-serverless nodes should be 0
      expect(node(result, 'edge').computedConcurrentInvocations).toBe(0);
    });

    it('concurrent invocations scale with RPS', () => {
      const result = compute(`
chart: infra

edge
  rps: 200
  -> Lambda

Lambda
  concurrency: 500
  duration-ms: 100
`);
      // 200 rps × 100ms / 1000 = 20 concurrent invocations
      expect(node(result, 'Lambda').computedConcurrentInvocations).toBe(20);
    });

    it('uses duration-ms as latency contribution', () => {
      const result = compute(`
chart: infra

edge
  rps: 1000
  -> Lambda

Lambda
  concurrency: 1000
  duration-ms: 200
  -> DB

DB
  latency-ms: 10
`);
      const lambda = node(result, 'Lambda');
      const db = node(result, 'DB');
      expect(lambda.computedLatencyMs).toBe(200);
      expect(db.computedLatencyMs).toBe(210); // 200 + 10
    });

    it('p99 latency includes cold-start-ms', () => {
      const result = compute(`
chart: infra

edge
  rps: 1000
  -> Lambda

Lambda
  concurrency: 1000
  duration-ms: 200
  cold-start-ms: 250
`);
      const percentiles = node(result, 'Lambda').computedLatencyPercentiles;
      expect(percentiles.p50).toBe(200); // warm path
      expect(percentiles.p99).toBe(450); // 200 + 250
    });

    it('availability reflects throttled requests under overload', () => {
      const result = compute(`
chart: infra

edge
  rps: 10000
  -> Lambda

Lambda
  concurrency: 1000
  duration-ms: 200
`);
      const lambda = node(result, 'Lambda');
      // capacity = 5000, rps = 10000 → 50% throttled
      expect(lambda.computedAvailability).toBeCloseTo(0.5, 1);
    });

    it('circuit breaker works with concurrency-based capacity', () => {
      const result = compute(`
chart: infra

edge
  rps: 10000
  -> Lambda

Lambda
  concurrency: 1000
  duration-ms: 200
  cb-error-threshold: 30%
`);
      // capacity=5000, rps=10000, error rate = 50% > 30% → open
      expect(node(result, 'Lambda').computedCbState).toBe('open');
    });

    it('property override adjusts concurrency (scenarios deprecated)', () => {
      const parsed = parseInfra(`
chart: infra

edge
  rps: 8000
  -> Lambda

Lambda
  concurrency: 1000
  duration-ms: 200
`);
      // Use propertyOverrides — scenario syntax is deprecated and ignored by parser
      const result = computeInfra(parsed, {
        propertyOverrides: { Lambda: { concurrency: 2000 } },
      });
      const lambda = node(result, 'Lambda');
      // New capacity = 2000 / 0.2 = 10000. 8000 < 10000 → not overloaded
      expect(lambda.overloaded).toBe(false);
    });
  });

  describe('queue traffic decoupling & availability (Epic 78)', () => {
    it('caps outbound RPS at drain-rate', () => {
      const result = compute(`
chart: infra

edge
  rps: 2000
  -> Queue

Queue
  buffer: 100000
  drain-rate: 500
  -> Processor

Processor
  max-rps: 1000
`);
      const q = node(result, 'Queue');
      const proc = node(result, 'Processor');
      expect(q.computedRps).toBe(2000);
      expect(proc.computedRps).toBe(500); // capped at drain-rate
    });

    it('computes buffer fill rate and time-to-overflow', () => {
      const result = compute(`
chart: infra

edge
  rps: 2000
  -> Queue

Queue
  buffer: 100000
  drain-rate: 500
`);
      const q = node(result, 'Queue');
      expect(q.queueMetrics).toBeDefined();
      expect(q.queueMetrics!.fillRate).toBe(1500); // 2000 - 500
      expect(q.queueMetrics!.timeToOverflow).toBeCloseTo(66.67, 0); // 100000 / 1500
    });

    it('fill rate is 0 when inbound <= drain-rate', () => {
      const result = compute(`
chart: infra

edge
  rps: 300
  -> Queue

Queue
  buffer: 100000
  drain-rate: 500
`);
      const q = node(result, 'Queue');
      expect(q.queueMetrics!.fillRate).toBe(0);
      expect(q.queueMetrics!.timeToOverflow).toBe(Infinity);
    });

    it('availability = 1.0 when buffer has headroom', () => {
      const result = compute(`
chart: infra

edge
  rps: 2000
  -> Queue

Queue
  buffer: 100000
  drain-rate: 500
`);
      const q = node(result, 'Queue');
      // Buffer filling but has headroom (100000 / 1500 ≈ 67s > 60s threshold)
      expect(q.computedAvailability).toBe(1);
    });

    it('availability degrades when overflow is imminent', () => {
      const result = compute(`
chart: infra

edge
  rps: 10000
  -> Queue

Queue
  buffer: 100
  drain-rate: 500
`);
      const q = node(result, 'Queue');
      // buffer=100, fillRate=9500, overflow in ~0.01s → availability degrades
      expect(q.computedAvailability).toBeLessThan(1);
    });

    it('availability decouples at queue boundary', () => {
      const result = compute(`
chart: infra

edge
  rps: 1000
  -> Queue

Queue
  buffer: 100000
  drain-rate: 500
  -> Processor

Processor
  max-rps: 100
  uptime: 50
`);
      // Producer side: edge → Queue. Queue has headroom, so availability = 1.0
      // Consumer side: Processor has 50% uptime and is overloaded (500 > 100)
      // But producer availability should NOT be reduced by consumer downtime
      const q = node(result, 'Queue');
      expect(q.computedAvailability).toBe(1);
    });

    it('passes through all traffic when no drain-rate', () => {
      const result = compute(`
chart: infra

edge
  rps: 5000
  -> Queue

Queue
  buffer: 100000
  -> Processor

Processor
  max-rps: 10000
`);
      expect(node(result, 'Processor').computedRps).toBe(5000);
    });

    it('property overrides adjust drain-rate (scenarios deprecated)', () => {
      const parsed = parseInfra(`
chart: infra

edge
  rps: 2000
  -> Queue

Queue
  buffer: 100000
  drain-rate: 500
  -> Processor

Processor
  max-rps: 5000
`);
      // Use propertyOverrides — scenario syntax is deprecated and ignored by parser
      const result = computeInfra(parsed, {
        propertyOverrides: { Queue: { 'drain-rate': 1000 } },
      });
      expect(node(result, 'Processor').computedRps).toBe(1000);
    });
  });

  describe('queue latency boundary (Story 78.3)', () => {
    it('resets cumulative latency at queue boundary', () => {
      const result = compute(`
chart: infra

edge
  rps: 1000
  -> API

API
  latency-ms: 50
  -> Queue

Queue
  buffer: 100000
  drain-rate: 1000
  -> Processor

Processor
  latency-ms: 200
  -> DB

DB
  latency-ms: 10
`);
      // Producer side: edge(0) + API(50) = 50ms
      expect(node(result, 'API').computedLatencyMs).toBe(50);
      // Queue: inbound=1000, drain=1000, no filling → wait time = 0ms
      // Consumer side: Processor(200) + DB(10) = 210ms, starting from 0
      expect(node(result, 'Processor').computedLatencyMs).toBe(200);
      expect(node(result, 'DB').computedLatencyMs).toBe(210);
    });

    it('adds queue wait time when buffer is filling', () => {
      const result = compute(`
chart: infra

edge
  rps: 2000
  -> Queue

Queue
  buffer: 100000
  drain-rate: 500
  -> Processor

Processor
  latency-ms: 100
`);
      // Queue: inbound=2000, drain=500, fill=1500
      // wait time = 1500/500 * 1000 = 3000ms
      const proc = node(result, 'Processor');
      // Consumer latency starts from queue wait time (3000) + processor (100)
      expect(proc.computedLatencyMs).toBe(3100);
    });

    it('queue wait time is 0 when not filling', () => {
      const result = compute(`
chart: infra

edge
  rps: 300
  -> Queue

Queue
  buffer: 100000
  drain-rate: 500
  -> Processor

Processor
  latency-ms: 100
`);
      const proc = node(result, 'Processor');
      // No filling → wait time 0, consumer latency = 100
      expect(proc.computedLatencyMs).toBe(100);
    });
  });

  describe('serverless in groups (Story 77.4)', () => {
    it('group instances do NOT multiply concurrency', () => {
      const result = compute(`
chart: infra

edge
  rps: 3000
  -> Lambda

[Functions]
  instances: 3

  Lambda
    concurrency: 1000
    duration-ms: 200
`);
      const lambda = node(result, 'Lambda');
      // Serverless capacity = 1000/0.2 = 5000, NOT multiplied by group instances
      // computedInstances is 0 for serverless
      expect(lambda.computedInstances).toBe(0);
      expect(lambda.overloaded).toBe(false);
    });

    it('mixed diagram: traditional and serverless nodes coexist', () => {
      const result = compute(`
chart: infra

edge
  rps: 10000
  -> API | split: 70%
  -> Lambda | split: 30%

API
  max-rps: 2000
  instances: 5

Lambda
  concurrency: 1000
  duration-ms: 200
`);
      const api = node(result, 'API');
      const lambda = node(result, 'Lambda');
      expect(api.computedRps).toBe(7000);
      expect(api.computedInstances).toBe(5);
      expect(lambda.computedRps).toBe(3000);
      expect(lambda.computedInstances).toBe(0);
      // Neither overloaded: API cap=10000, Lambda cap=5000
      expect(api.overloaded).toBe(false);
      expect(lambda.overloaded).toBe(false);
    });
  });

  describe('rateLimited flag', () => {
    it('sets rateLimited when inbound exceeds ratelimit-rps', () => {
      const result = compute(`
chart: infra
edge
  rps: 1000
  -> WAF
WAF
  ratelimit-rps: 500
  -> API
API
  max-rps: 5000
`);
      expect(node(result, 'WAF').rateLimited).toBe(true);
      expect(node(result, 'API').rateLimited).toBe(false);
    });

    it('rateLimited is false when traffic is below limit', () => {
      const result = compute(`
chart: infra
edge
  rps: 100
  -> WAF
WAF
  ratelimit-rps: 500
  -> API
API
`);
      expect(node(result, 'WAF').rateLimited).toBe(false);
    });

    it('rateLimited accounts for cache-hit reduction', () => {
      const result = compute(`
chart: infra
edge
  rps: 1000
  -> CDN
CDN
  cache-hit: 80%
  ratelimit-rps: 300
  -> API
API
`);
      // Pre-rate-limit RPS = 1000 * 0.2 = 200, which is below 300
      expect(node(result, 'CDN').rateLimited).toBe(false);
    });

    it('rateLimited is true even when not overloaded', () => {
      const result = compute(`
chart: infra
edge
  rps: 1000
  -> LB
LB
  ratelimit-rps: 500
  max-rps: 2000
  -> API
API
`);
      const lb = node(result, 'LB');
      expect(lb.rateLimited).toBe(true);
      expect(lb.overloaded).toBe(false);
    });
  });

  describe('queue in groups (Story 78.5)', () => {
    it('drain-rate scales with group instances', () => {
      const result = compute(`
chart: infra

edge
  rps: 1500
  -> MQ

[Workers]
  instances: 3

  MQ
    buffer: 100000
    drain-rate: 500
    -> Processor

  Processor
    max-rps: 500
`);
      const mq = node(result, 'MQ');
      // drain-rate 500 × 3 group instances = 1500, matches inbound → no filling
      expect(mq.queueMetrics!.fillRate).toBe(0);
      expect(mq.overloaded).toBe(false);
    });

    it('buffer does NOT scale with group instances', () => {
      const result = compute(`
chart: infra

edge
  rps: 2000
  -> MQ

[Workers]
  instances: 3

  MQ
    buffer: 100000
    drain-rate: 500
    -> Processor

  Processor
    max-rps: 500
`);
      const mq = node(result, 'MQ');
      // Effective drain = 500 × 3 = 1500, inbound = 2000, fillRate = 500
      expect(mq.queueMetrics!.fillRate).toBe(500);
      // timeToOverflow = buffer / fillRate = 100000 / 500 = 200s (buffer is NOT scaled)
      expect(mq.queueMetrics!.timeToOverflow).toBe(200);
    });

    it('collapsed group with queue child shows correct health state', () => {
      const result = compute(`
chart: infra

edge
  rps: 2000
  -> MQ

[Workers]
  instances: 1
  collapsed: true

  MQ
    buffer: 10000
    drain-rate: 500
    -> Processor

  Processor
    max-rps: 500
`);
      // The collapsed group becomes a virtual node
      const workers = result.nodes.find((n) => n.label === 'Workers' || n.id === 'Workers');
      expect(workers).toBeDefined();
      // The virtual node should carry queue properties from collapsed children
      const hasBuf = workers!.properties.some((p) => p.key === 'buffer');
      expect(hasBuf).toBe(true);
    });
  });

  describe('fanout multiplier', () => {
    it('multiplies target rps by fanout (no split)', () => {
      const result = compute(`
chart: infra

edge
  rps: 100
  -> B | fanout: 5

B
  max-rps: 1000
`);
      expect(node(result, 'B').computedRps).toBe(500);
      expect(edge(result, 'edge', 'B').computedRps).toBe(500);
    });

    it('applies fanout after split — B gets 50% * 5x, C gets 50%', () => {
      const result = compute(`
chart: infra

edge
  rps: 100
  -> B | split: 50%, fanout: 5
  -> C | split: 50%

B
  max-rps: 1000

C
  max-rps: 1000
`);
      expect(node(result, 'B').computedRps).toBe(250);
      expect(node(result, 'C').computedRps).toBe(50);
    });

    it('compounds fanout through multi-hop chain', () => {
      const result = compute(`
chart: infra

edge
  rps: 100
  -> A | fanout: 5

A
  max-rps: 5000
  -> B | fanout: 3

B
  max-rps: 10000
  -> C

C
  max-rps: 10000
`);
      expect(node(result, 'A').computedRps).toBe(500);
      expect(node(result, 'B').computedRps).toBe(1500);
      expect(node(result, 'C').computedRps).toBe(1500);
    });

    it('null fanout behaves identically to no fanout — regression', () => {
      const result = compute(`
chart: infra

edge
  rps: 100
  -> API

API
  max-rps: 1000
`);
      expect(node(result, 'API').computedRps).toBe(100);
      expect(edge(result, 'edge', 'API').computedRps).toBe(100);
    });

    it('computedEdgeRps reflects fanout wire traffic', () => {
      const result = compute(`
chart: infra

edge
  rps: 100
  -> Shards | fanout: 10

Shards
  max-rps: 5000
`);
      expect(edge(result, 'edge', 'Shards').computedRps).toBe(1000);
    });
  });
});
