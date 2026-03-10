import { describe, it, expect } from 'vitest';
import { inferRoles, collectDiagramRoles, collectFanoutSourceIds, FANOUT_ROLE } from '../src/infra/roles';
import type { InfraProperty } from '../src/infra/types';
import type { InfraLayoutEdge } from '../src/infra/layout';

function props(...keys: string[]): InfraProperty[] {
  return keys.map((key) => ({ key, value: '10', lineNumber: 1 }));
}

describe('infra role inference', () => {
  it('infers Cache role from cache-hit', () => {
    const roles = inferRoles(props('cache-hit'));
    expect(roles).toHaveLength(1);
    expect(roles[0].name).toBe('Cache');
  });

  it('infers Firewall role from firewall-block', () => {
    const roles = inferRoles(props('firewall-block'));
    expect(roles).toHaveLength(1);
    expect(roles[0].name).toBe('Firewall');
  });

  it('infers multiple roles from multiple properties', () => {
    const roles = inferRoles(props('cache-hit', 'ratelimit-rps'));
    expect(roles).toHaveLength(2);
    expect(roles.map((r) => r.name)).toContain('Cache');
    expect(roles.map((r) => r.name)).toContain('Rate Limiter');
  });

  it('infers Circuit Breaker from cb-error-threshold', () => {
    const roles = inferRoles(props('cb-error-threshold', 'max-rps'));
    expect(roles.map((r) => r.name)).toContain('Circuit Breaker');
    expect(roles.map((r) => r.name)).toContain('Service');
  });

  it('infers Queue role from buffer', () => {
    const roles = inferRoles(props('buffer', 'drain-rate'));
    expect(roles.map((r) => r.name)).toContain('Queue');
    expect(roles.find((r) => r.name === 'Queue')!.color).toBe('#8b5cf6');
  });

  it('infers Serverless role from concurrency', () => {
    const roles = inferRoles(props('concurrency', 'duration-ms'));
    expect(roles.map((r) => r.name)).toContain('Serverless');
    expect(roles.find((r) => r.name === 'Serverless')!.color).toBe('#06b6d4');
  });

  it('returns empty for no matching properties', () => {
    const roles = inferRoles(props('latency-ms', 'uptime'));
    expect(roles).toHaveLength(0);
  });

  it('collects unique roles across all components', () => {
    const allProps = [
      props('cache-hit'),
      props('cache-hit', 'firewall-block'),
      props('max-rps'),
    ];
    const roles = collectDiagramRoles(allProps);
    expect(roles.map((r) => r.name)).toEqual(['Cache', 'Firewall', 'Service']);
  });
});

function edge(sourceId: string, targetId: string, fanout: number | null): InfraLayoutEdge {
  return { sourceId, targetId, label: '', computedRps: 0, split: 100, fanout, points: [], lineNumber: 1 };
}

describe('collectFanoutSourceIds', () => {
  it('returns source ids of edges with fanout', () => {
    const edges = [edge('A', 'B', 3), edge('C', 'D', null)];
    const ids = collectFanoutSourceIds(edges);
    expect(ids.has('A')).toBe(true);
    expect(ids.has('C')).toBe(false);
    expect(ids.size).toBe(1);
  });

  it('returns empty set when no fanout edges', () => {
    const edges = [edge('A', 'B', null), edge('C', 'D', null)];
    expect(collectFanoutSourceIds(edges).size).toBe(0);
  });

  it('collects multiple fanout sources', () => {
    const edges = [edge('A', 'B', 2), edge('C', 'D', 5), edge('E', 'F', null)];
    const ids = collectFanoutSourceIds(edges);
    expect([...ids].sort()).toEqual(['A', 'C']);
  });

  it('FANOUT_ROLE has expected name and color', () => {
    expect(FANOUT_ROLE.name).toBe('Fan-Out');
    expect(FANOUT_ROLE.color).toMatch(/^#/);
  });
});
