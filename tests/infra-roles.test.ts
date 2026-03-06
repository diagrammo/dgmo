import { describe, it, expect } from 'vitest';
import { inferRoles, collectDiagramRoles } from '../src/infra/roles';
import type { InfraProperty } from '../src/infra/types';

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
