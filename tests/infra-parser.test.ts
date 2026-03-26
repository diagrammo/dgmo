import { describe, it, expect } from 'vitest';
import { parseInfra } from '../src/infra/parser';

describe('infra parser', () => {
  describe('chart declaration (FR1)', () => {
    it('parses chart: infra with title and direction', () => {
      const result = parseInfra(`
chart: infra
title: Production Traffic Flow
direction: LR
`);
      expect(result.type).toBe('infra');
      expect(result.title).toBe('Production Traffic Flow');
      expect(result.direction).toBe('LR');
      expect(result.error).toBeNull();
    });

    it('defaults direction to LR', () => {
      const result = parseInfra('chart: infra');
      expect(result.direction).toBe('LR');
    });

    it('supports TB direction', () => {
      const result = parseInfra('chart: infra\ndirection: TB');
      expect(result.direction).toBe('TB');
    });

    it('warns on unknown direction', () => {
      const result = parseInfra('chart: infra\ndirection: RL');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe('warning');
    });

    it('accepts orientation: as alias for direction:', () => {
      const result = parseInfra('chart: infra\norientation: vertical');
      expect(result.direction).toBe('TB');
    });

    it('normalizes direction: horizontal to LR', () => {
      const result = parseInfra('chart: infra\ndirection: horizontal');
      expect(result.direction).toBe('LR');
    });

    it('normalizes orientation: LR to LR', () => {
      const result = parseInfra('chart: infra\norientation: LR');
      expect(result.direction).toBe('LR');
    });

    it('errors on wrong chart type', () => {
      const result = parseInfra('chart: sequence');
      expect(result.error).toContain("Expected chart type 'infra'");
    });
  });

  describe('component blocks (FR2)', () => {
    it('parses a simple component', () => {
      const result = parseInfra(`
chart: infra

CloudFront
  cache-hit: 80%
`);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('CloudFront');
      expect(result.nodes[0].label).toBe('CloudFront');
      expect(result.nodes[0].properties).toHaveLength(1);
      expect(result.nodes[0].properties[0].key).toBe('cache-hit');
      expect(result.nodes[0].properties[0].value).toBe(80);
    });

    it('parses multiple components', () => {
      const result = parseInfra(`
chart: infra

CloudFront
  cache-hit: 80%

WAF
  firewall-block: 5%
`);
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0].id).toBe('CloudFront');
      expect(result.nodes[1].id).toBe('WAF');
    });
  });

  describe('edge component (FR6)', () => {
    it('parses edge with rps', () => {
      const result = parseInfra(`
chart: infra

edge
  rps: 10000
  -> CloudFront
`);
      const edgeNode = result.nodes.find((n) => n.isEdge);
      expect(edgeNode).toBeDefined();
      expect(edgeNode!.properties[0].key).toBe('rps');
      expect(edgeNode!.properties[0].value).toBe(10000);
    });

    it('warns when rps is used on non-edge component', () => {
      const result = parseInfra(`
chart: infra

CloudFront
  rps: 5000
`);
      const warn = result.diagnostics.find((d) =>
        d.message.includes('only valid on the entry point'),
      );
      expect(warn).toBeDefined();
    });
  });

  describe('connections (FR4)', () => {
    it('parses simple connection', () => {
      const result = parseInfra(`
chart: infra

edge
  rps: 10000
  -> CloudFront

CloudFront
  cache-hit: 80%
`);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].sourceId).toBe('edge');
      expect(result.edges[0].targetId).toBe('CloudFront');
      expect(result.edges[0].label).toBe('');
    });

    it('parses labeled connection', () => {
      const result = parseInfra(`
chart: infra

ALB
  -/api-> APIServer | split: 60%
  -/static-> StaticServer | split: 40%
`);
      expect(result.edges).toHaveLength(2);
      expect(result.edges[0].label).toBe('/api');
      expect(result.edges[0].targetId).toBe('APIServer');
      expect(result.edges[0].split).toBe(60);
      expect(result.edges[1].label).toBe('/static');
      expect(result.edges[1].split).toBe(40);
    });

    it('parses connection to group target', () => {
      const result = parseInfra(`
chart: infra

ALB
  -/api-> [API Pods] | split: 100%

[API Pods]
  APIServer
    instances: 3
`);
      expect(result.edges[0].targetId).toBe('[API Pods]');
    });
  });

  describe('behavior properties (FR3)', () => {
    it('parses percentage values', () => {
      const result = parseInfra(`
chart: infra

CDN
  cache-hit: 80%
  uptime: 99.99%
`);
      const cdn = result.nodes[0];
      expect(cdn.properties[0].value).toBe(80);
      expect(cdn.properties[1].value).toBe(99.99);
    });

    it('parses numeric values', () => {
      const result = parseInfra(`
chart: infra

API
  latency-ms: 45
  max-rps: 500
  instances: 3
  ratelimit-rps: 1000
`);
      const api = result.nodes[0];
      expect(api.properties.find((p) => p.key === 'latency-ms')!.value).toBe(45);
      expect(api.properties.find((p) => p.key === 'max-rps')!.value).toBe(500);
      expect(api.properties.find((p) => p.key === 'instances')!.value).toBe(3);
    });

    it('parses range values as string', () => {
      const result = parseInfra(`
chart: infra

API
  instances: 1-8
`);
      // Range is stored as string since it contains a dash
      expect(result.nodes[0].properties[0].value).toBe('1-8');
    });

    it('warns on unknown property key', () => {
      const result = parseInfra(`
chart: infra

API
  unknown-prop: 42
`);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("Unknown property 'unknown-prop'");
    });

    it('suggests close matches for typos', () => {
      const result = parseInfra(`
chart: infra

CDN
  cache-hti: 80%
`);
      const diag = result.diagnostics[0];
      expect(diag.message).toContain("Did you mean 'cache-hit'");
    });
  });

  describe('[Group] containers (FR5)', () => {
    it('parses groups with child components', () => {
      const result = parseInfra(`
chart: infra

[API Pods]
  APIServer
    instances: 3
    max-rps: 500
`);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].label).toBe('API Pods');
      expect(result.groups[0].id).toBe('[API Pods]');

      const apiServer = result.nodes.find((n) => n.id === 'APIServer');
      expect(apiServer).toBeDefined();
      expect(apiServer!.groupId).toBe('[API Pods]');
    });

    it('parses multiple components in a group', () => {
      const result = parseInfra(`
chart: infra

[Backend Services]
  APIServer
    max-rps: 500
  WorkerService
    max-rps: 200
`);
      expect(result.groups).toHaveLength(1);
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0].groupId).toBe('[Backend Services]');
      expect(result.nodes[1].groupId).toBe('[Backend Services]');
    });
  });

  describe('[Group] properties (Epic 76)', () => {
    it('parses group instances as number', () => {
      const result = parseInfra(`
chart: infra

[PVO]
  instances: 5

  PVONginx
    -> PVO
  PVO
`);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].instances).toBe(5);
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0].groupId).toBe('[PVO]');
    });

    it('parses group instances as range', () => {
      const result = parseInfra(`
chart: infra

[Backend]
  instances: 2-8

  APIServer
`);
      expect(result.groups[0].instances).toBe('2-8');
    });

    it('parses group collapsed property', () => {
      const result = parseInfra(`
chart: infra

[PVO]
  collapsed: true
  instances: 3

  PVONginx
  PVO
`);
      expect(result.groups[0].collapsed).toBe(true);
      expect(result.groups[0].instances).toBe(3);
      expect(result.nodes).toHaveLength(2);
    });

    it('groups without properties work as before', () => {
      const result = parseInfra(`
chart: infra

[MPV]
  MPVNginx
  MPVCore
`);
      expect(result.groups[0].instances).toBeUndefined();
      expect(result.groups[0].collapsed).toBeUndefined();
      expect(result.nodes).toHaveLength(2);
    });
  });

  describe('tag groups (FR7)', () => {
    it('parses tag group with alias and values', () => {
      const result = parseInfra(`
chart: infra

tag: Team alias t
  Backend(blue)
  Platform(teal)
  Commerce(orange)
`);
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Team');
      expect(result.tagGroups[0].alias).toBe('t');
      expect(result.tagGroups[0].values).toHaveLength(3);
      expect(result.tagGroups[0].values[0].name).toBe('Backend');
      expect(result.tagGroups[0].values[0].color).toBe('blue');
    });

    it('parses tag group without alias', () => {
      const result = parseInfra(`
chart: infra

tag: Environment
  Production
  Staging
`);
      expect(result.tagGroups[0].alias).toBeNull();
      expect(result.tagGroups[0].values).toHaveLength(2);
      expect(result.tagGroups[0].values[0].color).toBeUndefined();
    });
  });

  describe('pipe metadata on components', () => {
    it('parses tag assignments via pipe metadata', () => {
      const result = parseInfra(`
chart: infra

tag: Team alias t
  Backend(blue)

CloudFront | t: Backend
  cache-hit: 80%
`);
      const node = result.nodes.find((n) => n.id === 'CloudFront');
      expect(node!.tags).toEqual({ t: 'Backend' });
    });
  });

  describe('canonical example', () => {
    it('parses the full brainstorming example', () => {
      const result = parseInfra(`
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
      expect(result.error).toBeNull();
      expect(result.title).toBe('Production Traffic Flow');
      expect(result.direction).toBe('LR');

      // Tag groups
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Team');
      expect(result.tagGroups[0].values).toHaveLength(3);

      // Nodes: edge, CloudFront, CloudArmor, ALB, APIServer, PurchaseMS, StaticServer
      expect(result.nodes).toHaveLength(7);

      const edgeNode = result.nodes.find((n) => n.isEdge);
      expect(edgeNode).toBeDefined();
      expect(edgeNode!.properties.find((p) => p.key === 'rps')!.value).toBe(10000);

      const cf = result.nodes.find((n) => n.id === 'CloudFront');
      expect(cf!.tags).toEqual({ t: 'Platform' });
      expect(cf!.properties.find((p) => p.key === 'cache-hit')!.value).toBe(80);

      const api = result.nodes.find((n) => n.id === 'APIServer');
      expect(api!.groupId).toBe('[API Pods]');
      expect(api!.properties.find((p) => p.key === 'instances')!.value).toBe(3);

      const purchase = result.nodes.find((n) => n.id === 'PurchaseMS');
      expect(purchase!.groupId).toBe('[Commerce Pods]');

      // Groups
      expect(result.groups).toHaveLength(2);
      expect(result.groups[0].label).toBe('API Pods');
      expect(result.groups[1].label).toBe('Commerce Pods');

      // Edges: edge->CF, CF->CA, CA->ALB, ALB->/api->[API Pods], ALB->/purchase->[Commerce Pods], ALB->/static->Static
      expect(result.edges).toHaveLength(6);

      const albEdges = result.edges.filter((e) => e.sourceId === 'ALB');
      expect(albEdges).toHaveLength(3);
      expect(albEdges[0].label).toBe('/api');
      expect(albEdges[0].split).toBe(60);
      expect(albEdges[1].label).toBe('/purchase');
      expect(albEdges[1].split).toBe(30);
      expect(albEdges[2].label).toBe('/static');
      expect(albEdges[2].split).toBe(10);
    });
  });

  describe('serverless properties (Epic 77)', () => {
    it('parses concurrency, duration-ms, cold-start-ms as numeric values', () => {
      const result = parseInfra(`
chart: infra

ProcessOrder
  concurrency: 1000
  duration-ms: 200
  cold-start-ms: 250
  -> DB
`);
      expect(result.error).toBeNull();
      const node = result.nodes.find((n) => n.id === 'ProcessOrder');
      expect(node).toBeDefined();
      expect(node!.properties.find((p) => p.key === 'concurrency')!.value).toBe(1000);
      expect(node!.properties.find((p) => p.key === 'duration-ms')!.value).toBe(200);
      expect(node!.properties.find((p) => p.key === 'cold-start-ms')!.value).toBe(250);
      // No unknown property warnings
      const unknownWarnings = result.diagnostics.filter((d) => d.message.includes('Unknown property'));
      expect(unknownWarnings).toHaveLength(0);
    });

    it('emits diagnostic when concurrency used with instances', () => {
      const result = parseInfra(`
chart: infra

Lambda
  concurrency: 1000
  instances: 3
`);
      const warnings = result.diagnostics.filter((d) => d.message.includes('mutually exclusive'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('instances');
      // Still parses — warning, not error
      expect(result.nodes).toHaveLength(1);
    });

    it('emits diagnostic when concurrency used with max-rps', () => {
      const result = parseInfra(`
chart: infra

Lambda
  concurrency: 500
  max-rps: 2000
`);
      const warnings = result.diagnostics.filter((d) => d.message.includes('mutually exclusive'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('max-rps');
    });

    it('emits diagnostic mentioning both when concurrency used with instances and max-rps', () => {
      const result = parseInfra(`
chart: infra

Lambda
  concurrency: 500
  instances: 2
  max-rps: 1000
`);
      const warnings = result.diagnostics.filter((d) => d.message.includes('mutually exclusive'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('instances');
      expect(warnings[0].message).toContain('max-rps');
    });

    it('no diagnostic when concurrency used alone', () => {
      const result = parseInfra(`
chart: infra

Lambda
  concurrency: 1000
  duration-ms: 200
`);
      const warnings = result.diagnostics.filter((d) => d.message.includes('mutually exclusive'));
      expect(warnings).toHaveLength(0);
    });
  });

  describe('queue properties (Epic 78)', () => {
    it('parses buffer, drain-rate, retention-hours, partitions as numeric values', () => {
      const result = parseInfra(`
chart: infra

OrderQueue
  buffer: 100000
  drain-rate: 500
  retention-hours: 72
  partitions: 6
  -> OrderProcessor
`);
      expect(result.error).toBeNull();
      const node = result.nodes.find((n) => n.id === 'OrderQueue');
      expect(node).toBeDefined();
      expect(node!.properties.find((p) => p.key === 'buffer')!.value).toBe(100000);
      expect(node!.properties.find((p) => p.key === 'drain-rate')!.value).toBe(500);
      expect(node!.properties.find((p) => p.key === 'retention-hours')!.value).toBe(72);
      expect(node!.properties.find((p) => p.key === 'partitions')!.value).toBe(6);
      const unknownWarnings = result.diagnostics.filter((d) => d.message.includes('Unknown property'));
      expect(unknownWarnings).toHaveLength(0);
    });

    it('emits diagnostic when buffer used with max-rps', () => {
      const result = parseInfra(`
chart: infra

Queue
  buffer: 100000
  max-rps: 5000
`);
      const warnings = result.diagnostics.filter((d) => d.message.includes('capacity models'));
      expect(warnings).toHaveLength(1);
      expect(result.nodes).toHaveLength(1);
    });

    it('no diagnostic when buffer used alone', () => {
      const result = parseInfra(`
chart: infra

Queue
  buffer: 50000
  drain-rate: 1000
`);
      const warnings = result.diagnostics.filter((d) => d.message.includes('capacity models'));
      expect(warnings).toHaveLength(0);
    });
  });

  describe('comments and blank lines', () => {
    it('skips comments', () => {
      const result = parseInfra(`
chart: infra
// This is a comment
title: Test
`);
      expect(result.title).toBe('Test');
    });

    it('handles blank lines between components', () => {
      const result = parseInfra(`
chart: infra

edge
  rps: 1000

CDN
  cache-hit: 80%
`);
      expect(result.nodes).toHaveLength(2);
    });
  });

  describe('fanout multiplier (pipe metadata)', () => {
    it('parses simple connection with fanout via pipe metadata', () => {
      const result = parseInfra(`
chart: infra

edge
  rps: 100
  -> API | fanout: 5
`);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].fanout).toBe(5);
      expect(result.edges[0].split).toBeNull();
      expect(result.edges[0].targetId).toBe('API');
    });

    it('parses connection with both split and fanout in pipe metadata', () => {
      const result = parseInfra(`
chart: infra

edge
  rps: 100
  -> B | split: 50%, fanout: 3
  -> C | split: 50%
`);
      const edgeB = result.edges.find((e) => e.targetId === 'B')!;
      const edgeC = result.edges.find((e) => e.targetId === 'C')!;
      expect(edgeB.split).toBe(50);
      expect(edgeB.fanout).toBe(3);
      expect(edgeC.split).toBe(50);
      expect(edgeC.fanout).toBeNull();
    });

    it('parses labeled connection with fanout via pipe metadata', () => {
      const result = parseInfra(`
chart: infra

edge
  rps: 100
  -query-> Shards | fanout: 10
`);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].label).toBe('query');
      expect(result.edges[0].fanout).toBe(10);
      expect(result.edges[0].targetId).toBe('Shards');
    });

    it('parses connection without fanout — fanout is null (regression)', () => {
      const result = parseInfra(`
chart: infra

edge
  rps: 100
  -> API
`);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].fanout).toBeNull();
    });

    it('emits error for deprecated x5 fanout syntax on simple connection', () => {
      const result = parseInfra(`
chart: infra

edge
  rps: 100
  -> Database x5
`);
      expect(result.error).toContain("'x5' fanout syntax is no longer supported");
      expect(result.error).toContain("| fanout: 5");
    });

    it('emits error for deprecated xN fanout syntax on labeled connection', () => {
      const result = parseInfra(`
chart: infra

edge
  rps: 100
  -query-> Shards x10
`);
      expect(result.error).toContain("'x10' fanout syntax is no longer supported");
      expect(result.error).toContain("| fanout: 10");
    });
  });

  describe('line numbers', () => {
    it('tracks line numbers on nodes and edges', () => {
      const result = parseInfra(`chart: infra

edge
  rps: 1000
  -> CDN

CDN
  cache-hit: 80%`);
      const edgeNode = result.nodes.find((n) => n.isEdge);
      expect(edgeNode!.lineNumber).toBe(3);
      expect(edgeNode!.properties[0].lineNumber).toBe(4);
      expect(result.edges[0].lineNumber).toBe(5);

      const cdn = result.nodes.find((n) => n.id === 'CDN');
      expect(cdn!.lineNumber).toBe(7);
    });
  });

  describe('hyphenated node names', () => {
    it('parses node declarations with hyphens', () => {
      const result = parseInfra(`
chart: infra

api-gateway
  max-rps: 1000

my-service-v2
  latency-ms: 10
`);
      expect(result.error).toBeNull();
      const gw = result.nodes.find((n) => n.id === 'api-gateway');
      const svc = result.nodes.find((n) => n.id === 'my-service-v2');
      expect(gw).toBeDefined();
      expect(gw!.label).toBe('api-gateway');
      expect(svc).toBeDefined();
      expect(svc!.label).toBe('my-service-v2');
    });

    it('resolves connections to hyphenated node names', () => {
      const result = parseInfra(`
chart: infra

edge
  rps: 1000
  -> api-gateway

api-gateway
  max-rps: 5000
  -> auth-service

auth-service
  max-rps: 2000
`);
      expect(result.error).toBeNull();
      expect(result.edges).toHaveLength(2);
      expect(result.edges[0].targetId).toBe('api-gateway');
      expect(result.edges[1].sourceId).toBe('api-gateway');
      expect(result.edges[1].targetId).toBe('auth-service');
    });

    it('parses labeled connections to hyphenated node names', () => {
      const result = parseInfra(`
chart: infra

edge
  rps: 100
  -query-> search-service

search-service
  max-rps: 5000
`);
      expect(result.error).toBeNull();
      expect(result.edges[0].label).toBe('query');
      expect(result.edges[0].targetId).toBe('search-service');
    });

    it('parses hyphenated node names inside a group', () => {
      const result = parseInfra(`
chart: infra

[Shards]
  instances: 3

  shard-primary
    max-rps: 5000

  shard-replica
    max-rps: 5000
`);
      expect(result.error).toBeNull();
      const primary = result.nodes.find((n) => n.id === 'shard-primary');
      const replica = result.nodes.find((n) => n.id === 'shard-replica');
      expect(primary).toBeDefined();
      expect(primary!.groupId).toBe('[Shards]');
      expect(replica).toBeDefined();
      expect(replica!.groupId).toBe('[Shards]');
    });
  });

  describe('description field', () => {
    it('parses description on a node', () => {
      const result = parseInfra(`
chart: infra
APIServer
  description: Handles all REST API calls
`);
      expect(result.nodes[0].description).toBe('Handles all REST API calls');
      expect(result.nodes[0].properties).toHaveLength(0);
    });

    it('description with colon in value', () => {
      const result = parseInfra(`
chart: infra
AuthService
  description: Handles auth: JWT and sessions
`);
      expect(result.nodes[0].description).toBe('Handles auth: JWT and sessions');
    });

    it('description does not go into properties array', () => {
      const result = parseInfra(`
chart: infra
APIServer
  description: My service
  max-rps: 500
`);
      expect(result.nodes[0].description).toBe('My service');
      expect(result.nodes[0].properties).toHaveLength(1);
      expect(result.nodes[0].properties[0].key).toBe('max-rps');
    });

    it('description on edge node is silently ignored', () => {
      const result = parseInfra(`
chart: infra
edge
  rps: 1000
  description: This is the edge
  -> APIServer
`);
      const edgeNode = result.nodes.find((n) => n.isEdge);
      expect(edgeNode?.description).toBeUndefined();
      expect(result.diagnostics).toHaveLength(0);
    });

    it('no unknown-property warning for description', () => {
      const result = parseInfra(`
chart: infra
MyService
  description: Does things
`);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe('SLO chart-level options', () => {
    it('parses slo-availability as chart option', () => {
      const result = parseInfra(`
chart: infra
slo-availability: 99.9%
`);
      expect(result.options['slo-availability']).toBe('99.9%');
      expect(result.error).toBeNull();
    });

    it('parses slo-p90-latency-ms as chart option', () => {
      const result = parseInfra(`
chart: infra
slo-p90-latency-ms: 200
`);
      expect(result.options['slo-p90-latency-ms']).toBe('200');
      expect(result.error).toBeNull();
    });

    it('parses slo-warning-margin as chart option', () => {
      const result = parseInfra(`
chart: infra
slo-warning-margin: 10%
`);
      expect(result.options['slo-warning-margin']).toBe('10%');
      expect(result.error).toBeNull();
    });

    it('parses per-node slo-availability into node properties', () => {
      const result = parseInfra(`
chart: infra
API
  slo-availability: 99%
`);
      const apiNode = result.nodes.find((n) => n.id === 'API');
      const sloProp = apiNode?.properties.find((p) => p.key === 'slo-availability');
      // PROPERTY_RE already captures per-node SLO keys; % is stripped to number by parsePropertyValue
      expect(sloProp).toBeDefined();
      expect(Number(sloProp!.value)).toBe(99);
    });

    it('no unknown-property warning for per-node slo-availability', () => {
      const result = parseInfra(`
chart: infra
API
  slo-availability: 99%
`);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('no unknown-property warning for per-node slo-p90-latency-ms', () => {
      const result = parseInfra(`
chart: infra
API
  slo-p90-latency-ms: 200
`);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('no unknown-property warning for per-node slo-warning-margin', () => {
      const result = parseInfra(`
chart: infra
API
  slo-warning-margin: 10%
`);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('all three SLO keys coexist without warnings', () => {
      const result = parseInfra(`
chart: infra
slo-availability: 99%
slo-p90-latency-ms: 200
slo-warning-margin: 5%

API
  max-rps: 1000
  slo-availability: 95%
`);
      expect(result.options['slo-availability']).toBe('99%');
      expect(result.options['slo-p90-latency-ms']).toBe('200');
      expect(result.options['slo-warning-margin']).toBe('5%');
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe('async arrows (Task 3.1)', () => {
    it('parses ~> as async edge', () => {
      const result = parseInfra(`
chart: infra

API
  ~> Database
`);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].async).toBe(true);
      expect(result.edges[0].label).toBe('');
      expect(result.edges[0].targetId).toBe('Database');
    });

    it('parses ~label~> as async labeled edge', () => {
      const result = parseInfra(`
chart: infra

OrderService
  ~emit order~> EventBus
`);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].async).toBe(true);
      expect(result.edges[0].label).toBe('emit order');
      expect(result.edges[0].targetId).toBe('EventBus');
    });

    it('parses -> as sync edge (regression)', () => {
      const result = parseInfra(`
chart: infra

API
  -> Database
`);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].async).toBe(false);
      expect(result.edges[0].label).toBe('');
    });

    it('parses -label-> as sync labeled edge (regression)', () => {
      const result = parseInfra(`
chart: infra

ALB
  -/api-> API
`);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].async).toBe(false);
      expect(result.edges[0].label).toBe('/api');
    });

    it('async edge with split metadata', () => {
      const result = parseInfra(`
chart: infra

API
  ~> QueueA | split: 60%
  ~> QueueB | split: 40%
`);
      expect(result.edges).toHaveLength(2);
      expect(result.edges[0].async).toBe(true);
      expect(result.edges[0].split).toBe(60);
      expect(result.edges[1].async).toBe(true);
      expect(result.edges[1].split).toBe(40);
    });
  });

  describe('is-a type declarations (Task 3.2)', () => {
    it('parses "is a cache"', () => {
      const result = parseInfra(`
chart: infra

Redis is a cache
`);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('Redis');
      expect(result.nodes[0].label).toBe('Redis');
      expect(result.nodes[0].nodeType).toBe('cache');
    });

    it('parses "is a database"', () => {
      const result = parseInfra(`
chart: infra

PostgreSQL is a database
`);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].nodeType).toBe('database');
    });

    it('accepts "is an" for grammar forgiveness', () => {
      const result = parseInfra(`
chart: infra

ApiGateway is an gateway
`);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].nodeType).toBe('gateway');
    });

    it('node without is-a has undefined nodeType', () => {
      const result = parseInfra(`
chart: infra

AppServer
`);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].nodeType).toBeUndefined();
    });

    it('is-a node with connections works', () => {
      const result = parseInfra(`
chart: infra

API
  -> Redis

Redis is a cache
  latency-ms: 2
`);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].targetId).toBe('Redis');
      const redis = result.nodes.find(n => n.id === 'Redis');
      expect(redis).toBeDefined();
      expect(redis!.nodeType).toBe('cache');
      expect(redis!.properties).toHaveLength(1);
    });

    it('is-a inside group', () => {
      const result = parseInfra(`
chart: infra

[Backend]
  Redis is a cache
`);
      const redis = result.nodes.find(n => n.id === 'Redis');
      expect(redis).toBeDefined();
      expect(redis!.nodeType).toBe('cache');
      expect(redis!.groupId).toBe('[Backend]');
    });
  });

  describe('group metadata cascading (Task 3.5a)', () => {
    it('cascades group metadata to children', () => {
      const result = parseInfra(`
chart: infra

[Backend] | t: Engineering
  OrderAPI
`);
      const node = result.nodes.find(n => n.id === 'OrderAPI');
      expect(node).toBeDefined();
      expect(node!.tags.t).toBe('Engineering');
    });

    it('node-level metadata overrides group metadata', () => {
      const result = parseInfra(`
chart: infra

[Backend] | t: Engineering
  OrderAPI | t: Platform
`);
      const node = result.nodes.find(n => n.id === 'OrderAPI');
      expect(node).toBeDefined();
      expect(node!.tags.t).toBe('Platform');
    });

    it('group without metadata does not add tags to children (regression)', () => {
      const result = parseInfra(`
chart: infra

[Backend]
  OrderAPI
`);
      const node = result.nodes.find(n => n.id === 'OrderAPI');
      expect(node).toBeDefined();
      expect(Object.keys(node!.tags)).toHaveLength(0);
    });

    it('group metadata with multiple keys', () => {
      const result = parseInfra(`
chart: infra

[Backend] | t: Engineering, env: Prod
  OrderAPI
`);
      const node = result.nodes.find(n => n.id === 'OrderAPI');
      expect(node).toBeDefined();
      expect(node!.tags.t).toBe('Engineering');
      expect(node!.tags.env).toBe('Prod');
    });

    it('group metadata stored on group object', () => {
      const result = parseInfra(`
chart: infra

[Backend] | t: Engineering
  OrderAPI
`);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].metadata).toEqual({ t: 'Engineering' });
    });
  });
});
