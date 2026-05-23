import { describe, it, expect } from 'vitest';
import { splitNameAndMeta } from '../src/utils/parsing';
import {
  SEQUENCE_REGISTRY,
  C4_REGISTRY,
  GANTT_REGISTRY,
  JOURNEY_MAP_REGISTRY,
  withTagAliases,
} from '../src/utils/reserved-key-registry';
import type { DgmoError } from '../src/diagnostics';

describe('splitNameAndMeta — name region only', () => {
  it('returns the line as name when no reserved key appears', () => {
    const r = splitNameAndMeta('Alice', SEQUENCE_REGISTRY);
    expect(r.name).toBe('Alice');
    expect(r.meta).toEqual({});
    expect(r.color).toBeUndefined();
    expect(r.alias).toBeUndefined();
  });

  it('preserves multi-word bare names', () => {
    const r = splitNameAndMeta('Auth Service', SEQUENCE_REGISTRY);
    expect(r.name).toBe('Auth Service');
  });

  it('ignores colons inside quoted name tokens', () => {
    const r = splitNameAndMeta('"Auth: Service"', SEQUENCE_REGISTRY);
    expect(r.name).toBe('"Auth: Service"');
    expect(r.meta).toEqual({});
  });

  it('does not cut on a colon-token whose key is NOT reserved', () => {
    // `latency-ms` is not a sequence reserved key, so `latency-ms 50`
    // should not trigger any metadata extraction.
    const r = splitNameAndMeta(
      'API Gateway random-key: foo',
      SEQUENCE_REGISTRY
    );
    expect(r.name).toBe('API Gateway random-key: foo');
    expect(r.meta).toEqual({});
  });
});

describe('splitNameAndMeta — same-line metadata cut', () => {
  it('cuts at first reserved key and parses one pair', () => {
    const r = splitNameAndMeta('API Gateway description: Main', C4_REGISTRY);
    expect(r.name).toBe('API Gateway');
    expect(r.meta).toEqual({ description: 'Main' });
  });

  it('parses multiple comma-separated pairs', () => {
    const r = splitNameAndMeta(
      'API Gateway description: Main, tech: Node.js',
      C4_REGISTRY
    );
    expect(r.name).toBe('API Gateway');
    expect(r.meta).toEqual({ description: 'Main', tech: 'Node.js' });
  });

  it('tolerates whitespace around the colon', () => {
    const r1 = splitNameAndMeta('Foo description:Bar', C4_REGISTRY);
    const r2 = splitNameAndMeta('Foo description :Bar', C4_REGISTRY);
    const r3 = splitNameAndMeta('Foo description : Bar', C4_REGISTRY);
    const r4 = splitNameAndMeta('Foo description: Bar', C4_REGISTRY);
    expect(r1.meta).toEqual({ description: 'Bar' });
    expect(r2.meta).toEqual({ description: 'Bar' });
    expect(r3.meta).toEqual({ description: 'Bar' });
    expect(r4.meta).toEqual({ description: 'Bar' });
  });

  it('parses quoted values with embedded commas', () => {
    const r = splitNameAndMeta(
      'Layer description: "Security, employment, health"',
      C4_REGISTRY
    );
    expect(r.name).toBe('Layer');
    expect(r.meta).toEqual({
      description: 'Security, employment, health',
    });
  });

  it('parses quoted values mixed with unquoted', () => {
    const r = splitNameAndMeta(
      'Layer description: "a, b", tech: React',
      C4_REGISTRY
    );
    expect(r.meta).toEqual({ description: 'a, b', tech: 'React' });
  });
});

describe('splitNameAndMeta — empty value diagnostic', () => {
  it('drops empty-value pair and emits W_EMPTY_METADATA_VALUE', () => {
    const diagnostics: DgmoError[] = [];
    const r = splitNameAndMeta(
      'Foo description:',
      C4_REGISTRY,
      new Map(),
      undefined,
      diagnostics,
      42
    );
    expect(r.meta).toEqual({});
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      line: 42,
      severity: 'warning',
      code: 'W_EMPTY_METADATA_VALUE',
    });
  });

  it('drops one empty value and keeps the other', () => {
    const diagnostics: DgmoError[] = [];
    const r = splitNameAndMeta(
      'Foo description:, tech: React',
      C4_REGISTRY,
      new Map(),
      undefined,
      diagnostics,
      1
    );
    expect(r.meta).toEqual({ tech: 'React' });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('W_EMPTY_METADATA_VALUE');
  });
});

describe('splitNameAndMeta — as <alias> postfix', () => {
  it('strips as <alias> from name region', () => {
    const r = splitNameAndMeta('Alice as a', SEQUENCE_REGISTRY);
    expect(r.name).toBe('Alice');
    expect(r.alias).toBe('a');
  });

  it('strips alias before applying trailing-token color', () => {
    const r = splitNameAndMeta('Alice as a green', SEQUENCE_REGISTRY);
    expect(r.name).toBe('Alice');
    expect(r.alias).toBe('a');
    expect(r.color).toBeDefined();
  });

  it('strips alias from name region, then parses metadata', () => {
    const r = splitNameAndMeta('Alice as a description: Hi', SEQUENCE_REGISTRY);
    expect(r.name).toBe('Alice');
    expect(r.alias).toBe('a');
    expect(r.meta).toEqual({ description: 'Hi' });
  });
});

describe('splitNameAndMeta — §1.5 cut order (color in name region only)', () => {
  it('extracts color from name region when color word precedes metadata', () => {
    const r = splitNameAndMeta('Spring green description: First', C4_REGISTRY);
    expect(r.name).toBe('Spring');
    expect(r.color).toBeDefined();
    expect(r.meta).toEqual({ description: 'First' });
  });

  it('does NOT extract color from inside metadata value', () => {
    // `green` is part of the description value, not the entity color.
    const r = splitNameAndMeta('Spring description: Auth green', C4_REGISTRY);
    expect(r.name).toBe('Spring');
    expect(r.color).toBeUndefined();
    expect(r.meta).toEqual({ description: 'Auth green' });
  });
});

describe('splitNameAndMeta — tag alias dispatch', () => {
  it('dispatches on tag alias added to the registry', () => {
    // `c` is not in the static C4 registry; it's a declared tag alias.
    const registry = withTagAliases(C4_REGISTRY, new Set(['c']));
    const aliasMap = new Map([['c', 'concern']]);
    const r = splitNameAndMeta('API Gateway c: Auth', registry, aliasMap);
    expect(r.name).toBe('API Gateway');
    expect(r.meta).toEqual({ concern: 'Auth' });
  });

  it('falls through when alias is not registered', () => {
    // Without `c` in the registry, `c: Auth` does not trigger the cut.
    const r = splitNameAndMeta('API Gateway c: Auth', C4_REGISTRY);
    expect(r.name).toBe('API Gateway c: Auth');
    expect(r.meta).toEqual({});
  });
});

describe('splitNameAndMeta — gantt progress key (post-migration)', () => {
  it('parses progress key on a gantt task line', () => {
    const r = splitNameAndMeta(
      '20bd Database Schema progress: 100',
      GANTT_REGISTRY
    );
    expect(r.name).toBe('20bd Database Schema');
    expect(r.meta).toEqual({ progress: '100' });
  });
});

describe('splitNameAndMeta — journey-map score/emotion (post-migration)', () => {
  it('parses score and emotion keys', () => {
    const r = splitNameAndMeta(
      'Hit error score: 1, emotion: Frustrated',
      JOURNEY_MAP_REGISTRY
    );
    expect(r.name).toBe('Hit error');
    expect(r.meta).toEqual({ score: '1', emotion: 'Frustrated' });
  });
});

describe('splitNameAndMeta — registry isolation', () => {
  it('different chart-type registries produce different cuts', () => {
    // `tech` is reserved in C4 but NOT in sequence.
    const c4 = splitNameAndMeta('Web App tech: React', C4_REGISTRY);
    expect(c4.name).toBe('Web App');
    expect(c4.meta).toEqual({ tech: 'React' });

    const seq = splitNameAndMeta('Web App tech: React', SEQUENCE_REGISTRY);
    expect(seq.name).toBe('Web App tech: React');
    expect(seq.meta).toEqual({});
  });
});
