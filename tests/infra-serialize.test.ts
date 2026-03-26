import { describe, it, expect } from 'vitest';
import { parseInfra } from '../src/infra/parser';
import { computeInfra } from '../src/infra/compute';
import { serializeScenario } from '../src/infra/serialize';

const BASE = `
infra

edge
  rps 10000
  -> CDN

CDN
  cache-hit 80%
  -> API

API
  max-rps 2000
  instances 3
  latency-ms 50
  -> DB

DB
  max-rps 5000
`;

function parse(source = BASE) {
  const parsed = parseInfra(source);
  expect(parsed.error).toBeNull();
  return parsed;
}

describe('serializeScenario', () => {
  it('returns empty string when nothing differs', () => {
    const parsed = parse();
    const result = serializeScenario('base', parsed, {});
    expect(result).toBe('');
  });

  it('serializes RPS override on edge', () => {
    const parsed = parse();
    const result = serializeScenario('peak', parsed, { rps: 50000 });
    expect(result).toContain('scenario: peak');
    expect(result).toContain('  edge');
    expect(result).toContain('    rps: 50000');
  });

  it('does not include edge RPS when value matches base', () => {
    const parsed = parse();
    const result = serializeScenario('same', parsed, { rps: 10000 });
    expect(result).toBe('');
  });

  it('serializes instance overrides', () => {
    const parsed = parse();
    const result = serializeScenario('scale', parsed, {
      instanceOverrides: { API: 10 },
    });
    expect(result).toContain('  API');
    expect(result).toContain('    instances: 10');
    // Should not include DB (no override)
    expect(result).not.toContain('DB');
  });

  it('does not include instance override matching base', () => {
    const parsed = parse();
    const result = serializeScenario('same', parsed, {
      instanceOverrides: { API: 3 },
    });
    expect(result).toBe('');
  });

  it('serializes property overrides', () => {
    const parsed = parse();
    const result = serializeScenario('degraded-cache', parsed, {
      propertyOverrides: { CDN: { 'cache-hit': 40 } },
    });
    expect(result).toContain('  CDN');
    expect(result).toContain('    cache-hit: 40');
  });

  it('omits property override matching base value', () => {
    const parsed = parse();
    const result = serializeScenario('same', parsed, {
      propertyOverrides: { CDN: { 'cache-hit': 80 } },
    });
    expect(result).toBe('');
  });

  it('serializes all override types together', () => {
    const parsed = parse();
    const result = serializeScenario('black-friday', parsed, {
      rps: 50000,
      instanceOverrides: { API: 20 },
      propertyOverrides: { CDN: { 'cache-hit': 40 } },
    });
    expect(result).toContain('scenario: black-friday');
    expect(result).toContain('    rps: 50000');
    expect(result).toContain('    instances: 20');
    expect(result).toContain('    cache-hit: 40');
    // Ends with trailing newline
    expect(result.endsWith('\n')).toBe(true);
  });

  it('serialize generates valid scenario text (note: parser ignores scenario blocks as deprecated)', () => {
    const parsed = parse();
    const overrides = {
      rps: 50000,
      instanceOverrides: { API: 10 },
      propertyOverrides: { CDN: { 'cache-hit': 40 } },
    };

    const scenarioText = serializeScenario('test', parsed, overrides);
    // Serialized text contains expected scenario block
    expect(scenarioText).toContain('scenario: test');
    expect(scenarioText).toContain('rps: 50000');
    expect(scenarioText).toContain('instances: 10');
    expect(scenarioText).toContain('cache-hit: 40');

    // Compute directly with same overrides — scenarios are deprecated in the parser
    const computedWithOverrides = computeInfra(parsed, overrides);
    const apiNode = computedWithOverrides.nodes.find((n) => n.id === 'API')!;
    expect(apiNode.computedInstances).toBe(10);
  });

  it('serializes queue property overrides', () => {
    const source = `
infra
edge
  rps 1000
  -> MQ
MQ
  buffer 100000
  drain-rate 500
  -> Proc
Proc
  max-rps 500
`;
    const parsed = parse(source);
    const result = serializeScenario('burst', parsed, {
      rps: 5000,
      propertyOverrides: { MQ: { 'drain-rate': 1000 } },
    });
    expect(result).toContain('    rps: 5000');
    expect(result).toContain('    drain-rate: 1000');
  });

  it('serializes serverless property overrides', () => {
    const source = `
infra
edge
  rps 1000
  -> Lambda
Lambda
  concurrency 500
  duration-ms 200
`;
    const parsed = parse(source);
    const result = serializeScenario('scale', parsed, {
      propertyOverrides: { Lambda: { concurrency: 1000 } },
    });
    expect(result).toContain('    concurrency: 1000');
  });
});
