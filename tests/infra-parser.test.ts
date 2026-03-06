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
});
