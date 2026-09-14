// check-security.mjs — the wrapper that stops a slow registry reading as a CVE.
//
// 🔴 The property under test is NOT "the audit works". It is that the three
// outcomes are TOLD APART: audited-and-clean, audited-and-found-something, and
// could-not-audit. Before this wrapper all three of `ERR_SOCKET_TIMEOUT`, a
// real advisory and an unparseable failure exited 1, which is how a transport
// failure blocked a release twice on 2026-09-03 while reading like a security
// finding (diagrammo/diagrammo#681).
//
// Everything here runs offline. `audit()` takes its runner as a parameter for
// exactly that reason: the retry policy is the part that only misbehaves on a
// bad network, so it is the part that must be exercisable without one.

import { describe, expect, it } from 'vitest';

import {
  ATTEMPTS,
  audit,
  classify,
  report,
} from '../scripts/check-security.mjs';

/** A clean report, in the shape `pnpm audit --prod --json` really prints. */
const CLEAN_JSON = JSON.stringify({
  actions: [],
  advisories: {},
  muted: [],
  metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
    dependencies: 63,
    devDependencies: 0,
    optionalDependencies: 0,
    totalDependencies: 63,
  },
});

const FINDINGS_JSON = JSON.stringify({
  actions: [],
  advisories: { '1234': { severity: 'high' } },
  muted: [],
  metadata: {
    vulnerabilities: { info: 0, low: 1, moderate: 0, high: 2, critical: 0 },
    dependencies: 63,
    totalDependencies: 63,
  },
});

const TIMEOUT_STDERR = `
 WARN  post https://registry.npmjs.org/-/npm/v1/security/audits error (ERR_SOCKET_TIMEOUT). Will retry in 10 seconds. 2 retries left.
 WARN  post https://registry.npmjs.org/-/npm/v1/security/audits error (ERR_SOCKET_TIMEOUT). Will retry in 1 minute. 1 retries left.
 ERR_SOCKET_TIMEOUT  request to https://registry.npmjs.org/-/npm/v1/security/audits failed, reason: Socket timeout
 ELIFECYCLE  Command failed with exit code 1.
`;

describe('classify — what one audit run actually said', () => {
  it('a clean report is clean', () => {
    expect(classify({ status: 0, stdout: CLEAN_JSON, stderr: '' })).toEqual({
      kind: 'clean',
    });
  });

  it('a report with vulnerabilities is a finding, and counts them', () => {
    const r = classify({ status: 1, stdout: FINDINGS_JSON, stderr: '' });
    expect(r.kind).toBe('findings');
    if (r.kind !== 'findings') return;
    expect(r.total).toBe(3);
    expect(r.counts.high).toBe(2);
  });

  it('a socket timeout is unreachable, not a finding', () => {
    const r = classify({ status: 1, stdout: '', stderr: TIMEOUT_STDERR });
    expect(r.kind).toBe('unreachable');
  });

  // 🔴 The regression this wrapper is most likely to grow. pnpm retries
  // internally and prints a WARN for each attempt, so a run that SUCCEEDED on
  // its third go still carries `ERR_SOCKET_TIMEOUT` in stderr. Reading stderr
  // before stdout would throw away a report we are holding and call it a
  // network failure — on this Mac that is the ordinary shape of a good run.
  it('a report that arrived after internal retries is read, not discarded', () => {
    expect(
      classify({ status: 0, stdout: CLEAN_JSON, stderr: TIMEOUT_STDERR })
    ).toEqual({ kind: 'clean' });
  });

  it('findings win over a stale timeout warning too', () => {
    const r = classify({
      status: 1,
      stdout: FINDINGS_JSON,
      stderr: TIMEOUT_STDERR,
    });
    expect(r.kind).toBe('findings');
  });

  // 🔴 The fallback must BLOCK. "I cannot account for this" filed under
  // "the network was bad" is the exact conflation this file exists to end,
  // just pointing the other way.
  it('an unrecognised failure is unknown, and unknown is not unreachable', () => {
    const r = classify({
      status: 1,
      stdout: '',
      stderr: 'ERR_PNPM_SOMETHING_NEW  the audit blew up in a novel fashion',
    });
    expect(r.kind).toBe('unknown');
    expect(report(r).code).toBe(1);
  });

  it('a non-audit JSON document on stdout is not mistaken for a report', () => {
    const r = classify({
      status: 1,
      stdout: '{"error":"nope"}',
      stderr: 'ECONNRESET while talking to the registry',
    });
    expect(r.kind).toBe('unreachable');
  });
});

describe('audit — retries only while the registry is unreachable', () => {
  const timeoutRun = () => ({ status: 1, stdout: '', stderr: TIMEOUT_STDERR });
  const cleanRun = () => ({ status: 0, stdout: CLEAN_JSON, stderr: '' });

  it('retries a timeout and takes the answer when one arrives', () => {
    const outcomes = [timeoutRun, timeoutRun, cleanRun];
    let calls = 0;
    const slept: number[] = [];
    const result = audit({
      run: () => outcomes[calls++]!(),
      sleep: (ms) => slept.push(ms),
      log: () => {},
    });
    expect(result.kind).toBe('clean');
    expect(calls).toBe(3);
    expect(slept).toHaveLength(2);
    expect(slept.every((ms) => ms > 0)).toBe(true);
  });

  it('gives up after ATTEMPTS and reports unreachable', () => {
    let calls = 0;
    const result = audit({
      run: () => {
        calls++;
        return timeoutRun();
      },
      sleep: () => {},
      log: () => {},
    });
    expect(calls).toBe(ATTEMPTS);
    expect(result.kind).toBe('unreachable');
  });

  // 🔴 A finding must not be retried. Retrying it would spend the gate's time
  // re-confirming a real answer, and — worse — a flaky endpoint on the retry
  // could turn a genuine CVE into a SKIPPED pass.
  it('does not retry a finding', () => {
    let calls = 0;
    const result = audit({
      run: () => {
        calls++;
        return { status: 1, stdout: FINDINGS_JSON, stderr: '' };
      },
      sleep: () => {
        throw new Error('must not sleep after a real answer');
      },
      log: () => {},
    });
    expect(calls).toBe(1);
    expect(result.kind).toBe('findings');
  });

  it('does not retry a clean answer', () => {
    let calls = 0;
    audit({
      run: () => {
        calls++;
        return cleanRun();
      },
      sleep: () => {
        throw new Error('must not sleep after a real answer');
      },
      log: () => {},
    });
    expect(calls).toBe(1);
  });
});

describe('report — the exit code means one thing, and the line says which', () => {
  it('clean passes', () => {
    expect(report({ kind: 'clean' }).code).toBe(0);
  });

  it('a finding fails, and says it is a real finding', () => {
    const r = report({
      kind: 'findings',
      total: 3,
      counts: { high: 2, low: 1 },
    });
    expect(r.code).toBe(1);
    expect(r.lines.join('\n')).toContain('real finding');
  });

  // 🔴 The whole policy, asserted: an unreachable registry PASSES, and is
  // impossible to confuse with a clean audit when someone reads the log. The
  // pass is only defensible because the message is unmissable, so the message
  // is part of the contract and not decoration.
  it('unreachable passes, and says plainly that nothing was audited', () => {
    const r = report({ kind: 'unreachable', marker: 'ERR_SOCKET_TIMEOUT' });
    expect(r.code).toBe(0);
    const text = r.lines.join('\n');
    expect(text).toContain('SKIPPED');
    expect(text).toContain('NOTHING WAS AUDITED');
    expect(text).toContain('not a security finding');
  });

  it('a clean run never claims anything was skipped', () => {
    expect(report({ kind: 'clean' }).lines.join('\n')).not.toContain('SKIPPED');
  });
});
