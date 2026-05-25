import { describe, it, expect } from 'vitest';
import { parseInfra } from '../src/infra/parser';
import { computeInfra } from '../src/infra/compute';
import { validateInfra, validateComputed } from '../src/infra/validation';

function validate(source: string) {
  const parsed = parseInfra(source);
  return validateInfra(parsed);
}

function validateWithCompute(source: string) {
  const parsed = parseInfra(source);
  const computed = computeInfra(parsed);
  return validateComputed(computed);
}

describe('infra validation', () => {
  describe('FR19: split validation', () => {
    it('passes when all splits sum to 100%', () => {
      const diags = validate(`
infra

LB
  -> A | split: 60%
  -> B | split: 40%

A
  latency-ms: 10

B
  latency-ms: 10
`);
      expect(diags.filter((d) => d.type === 'SPLIT_SUM')).toHaveLength(0);
    });

    it('warns when all splits do not sum to 100%', () => {
      const diags = validate(`
infra

LB
  -> A | split: 50%
  -> B | split: 30%

A
  latency-ms: 10

B
  latency-ms: 10
`);
      const split = diags.filter((d) => d.type === 'SPLIT_SUM');
      expect(split).toHaveLength(1);
      expect(split[0].message).toContain('80%');
    });

    it('warns when declared splits exceed 100%', () => {
      const diags = validate(`
infra

LB
  -> A | split: 70%
  -> B | split: 50%

A
  latency-ms: 10

B
  latency-ms: 10
`);
      const split = diags.filter((d) => d.type === 'SPLIT_SUM');
      expect(split).toHaveLength(1);
      expect(split[0].message).toContain('120%');
    });

    it('passes with partial splits where declared < 100', () => {
      const diags = validate(`
infra

LB
  -> A | split: 60%
  -> B

A
  latency-ms: 10

B
  latency-ms: 10
`);
      expect(diags.filter((d) => d.type === 'SPLIT_SUM')).toHaveLength(0);
    });

    it('passes when no splits declared (even inference)', () => {
      const diags = validate(`
infra

LB
  -> A
  -> B

A
  latency-ms: 10

B
  latency-ms: 10
`);
      expect(diags.filter((d) => d.type === 'SPLIT_SUM')).toHaveLength(0);
    });

    it('passes for single outbound edge (no split needed)', () => {
      const diags = validate(`
infra

edge
  rps: 1000
  -> CDN

CDN
  cache-hit: 80%
`);
      expect(diags.filter((d) => d.type === 'SPLIT_SUM')).toHaveLength(0);
    });
  });

  describe('FR20: cycle detection', () => {
    it('detects a direct cycle (A -> B -> A)', () => {
      const diags = validate(`
infra

edge
  rps: 1000
  -> A

A
  -> B

B
  -> A
`);
      const cycles = diags.filter((d) => d.type === 'CYCLE');
      expect(cycles).toHaveLength(1);
      // Cycle message references node ids (post-Phase-B: lowercased).
      expect(cycles[0].message.toLowerCase()).toContain('b');
      expect(cycles[0].message.toLowerCase()).toContain('a');
    });

    it('passes for a valid DAG', () => {
      const diags = validate(`
infra

edge
  rps: 1000
  -> A

A
  -> B

B
  -> C

C
  latency-ms: 10
`);
      expect(diags.filter((d) => d.type === 'CYCLE')).toHaveLength(0);
    });

    it('passes for diamond DAG (A -> B, A -> C, B -> D, C -> D)', () => {
      const diags = validate(`
infra

edge
  rps: 1000
  -> A

A
  -> B
  -> C

B
  -> D

C
  -> D

D
  latency-ms: 10
`);
      expect(diags.filter((d) => d.type === 'CYCLE')).toHaveLength(0);
    });
  });

  describe('orphan detection', () => {
    it('detects orphan nodes not reachable from edge', () => {
      const diags = validate(`
infra

edge
  rps: 1000
  -> A

A
  latency-ms: 10

Orphan
  latency-ms: 20
`);
      const orphans = diags.filter((d) => d.type === 'ORPHAN');
      expect(orphans).toHaveLength(1);
      expect(orphans[0].message).toContain('Orphan');
    });

    it('does not flag group children as orphans when group is targeted', () => {
      const diags = validate(`
infra

edge
  rps: 1000
  -> [Backend]

[Backend]
  API1
    latency-ms: 10
  API2
    latency-ms: 10
`);
      expect(diags.filter((d) => d.type === 'ORPHAN')).toHaveLength(0);
    });
  });

  describe('clean canonical example', () => {
    it('has no validation errors', () => {
      const diags = validate(`
infra Production Traffic Flow

tag Team t
  Backend blue
  Platform teal

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
  PurchaseMS
    instances: 1-8
    max-rps: 300

StaticServer | t: Platform
`);
      expect(diags.filter((d) => d.type === 'CYCLE')).toHaveLength(0);
      expect(diags.filter((d) => d.type === 'SPLIT_SUM')).toHaveLength(0);
      expect(diags.filter((d) => d.type === 'ORPHAN')).toHaveLength(0);
    });
  });

  describe('FR22: uptime/SLA warnings', () => {
    it('warns when system uptime is below 99%', () => {
      const diags = validateWithCompute(`
infra

edge
  rps: 1000
  -> API

API
  uptime: 95%
  latency-ms: 10
`);
      const uptime = diags.filter((d) => d.type === 'UPTIME');
      expect(uptime).toHaveLength(1);
      expect(uptime[0].message).toContain('95.00%');
    });

    it('passes when system uptime is above 99%', () => {
      const diags = validateWithCompute(`
infra

edge
  rps: 1000
  -> API

API
  uptime: 99.9%
  latency-ms: 10
`);
      expect(diags.filter((d) => d.type === 'UPTIME')).toHaveLength(0);
    });
  });
});
