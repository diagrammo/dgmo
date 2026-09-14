#!/usr/bin/env node
// `pnpm audit --prod` with its own retry budget, and — the point of this file —
// an exit code that means one thing.
//
// 🔴 A transport failure and a found vulnerability both exited 1 before this
// existed, so a gate that could not REACH the registry was indistinguishable
// from one that reached it and found a CVE. That blocked a real release twice
// in a row on 2026-09-03: two `release-cascade.sh` runs refused `dgmo` at
// `3f8b4a49` on `ERR_SOCKET_TIMEOUT` against
// `https://registry.npmjs.org/-/npm/v1/security/audits`, and a third run passed
// with no other change. `status.npmjs.org` said All Systems Operational
// throughout, and a bare 30-second curl POST to that endpoint timed out from
// both machines — so this is the endpoint being slow, not either box being
// broken, and either box can fall off pnpm's three-retry budget.
//
// 🔴 In this repo the cost is worse than "a slow check". `check:security` is
// step 9 of 14 in `check:all` — between `check:dep-ranges` and the api-baseline
// test — so a timeout there also discards `build`, `check:api`, `check:publish`
// and `check:types`, which had already been paid for or were about to be.
//
// The policy, stated here so nobody has to read the script to know whether the
// gate ran: a registry we cannot reach SAYS SO and PASSES. It does not fail the
// build for a reason that has nothing to do with what it audits. That is not a
// new rule — `scripts/check-dep-ranges.mjs` is the other check in this repo
// that reads the registry, and it has said the same since it was written:
// "Offline, it says so and passes rather than failing a build for a reason
// unrelated to the change." `diagrammo-app`'s pre-push gate drops
// `check:security` outright for the same reason, written down as "a push must
// not fail on a train".
//
// What still fails: a vulnerability (exit 1), and an audit whose output we
// cannot account for (exit 1). The second is deliberate — "I do not know what
// happened" must never be quietly filed under "the network was bad".

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Attempts, including the first. pnpm has its own 3 internal retries inside each. */
export const ATTEMPTS = 3;
/** Backoff before attempt n+1, in ms. Short: the gate is waiting. */
export const BACKOFF_MS = [2_000, 8_000];

/**
 * Markers that mean "the request never got an answer", as opposed to an answer
 * we did not like. Matched against the audit's combined stderr+stdout.
 *
 * 🔴 Kept as a positive list on purpose. The fallback for anything unmatched is
 * `unknown`, which BLOCKS — so a transport error spelled in some way this list
 * does not know fails loudly and gets added here, rather than being waved
 * through as "probably the network".
 */
const TRANSPORT_MARKERS = [
  'ERR_SOCKET_TIMEOUT',
  'ERR_PNPM_FETCH_',
  'ENOTFOUND',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'socket hang up',
  'network timeout',
  'request to',
];

/**
 * What one `pnpm audit --prod --json` run actually told us.
 *
 * 🔴 Parseability of stdout is asked FIRST, and that ordering is the whole
 * classifier. If the registry answered, its JSON is on stdout whatever the exit
 * code was — pnpm exits 1 on findings — so a run that produced a report is
 * never a transport failure, even when a retry warning naming a socket timeout
 * is also sitting in stderr from an earlier internal attempt. Reading stderr
 * first would classify a successful audit-with-retries as unreachable and skip
 * a report we are holding.
 *
 * @param {{ status: number|null, stdout: string, stderr: string }} run
 * @returns {{ kind: 'clean' }
 *   | { kind: 'findings', total: number, counts: Record<string, number> }
 *   | { kind: 'unreachable', marker: string }
 *   | { kind: 'unknown', detail: string }}
 */
export function classify(run) {
  const stdout = run.stdout ?? '';
  const stderr = run.stderr ?? '';

  const report = parseReport(stdout);
  if (report) {
    const counts = report.metadata?.vulnerabilities ?? {};
    const total = Object.values(counts).reduce(
      (a, b) => a + (typeof b === 'number' ? b : 0),
      0
    );
    return total > 0 ? { kind: 'findings', total, counts } : { kind: 'clean' };
  }

  const haystack = `${stderr}\n${stdout}`;
  const marker = TRANSPORT_MARKERS.find((m) => haystack.includes(m));
  if (marker) return { kind: 'unreachable', marker };

  return {
    kind: 'unknown',
    detail: lastMeaningfulLine(haystack) || `exit ${run.status}`,
  };
}

/** The audit report, or null if stdout is not one. */
function parseReport(stdout) {
  const start = stdout.indexOf('{');
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(stdout.slice(start));
    // `metadata.vulnerabilities` is what makes it an audit report rather than
    // some other JSON pnpm decided to print.
    return parsed && typeof parsed === 'object' && parsed.metadata
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function lastMeaningfulLine(text) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

/**
 * Run the audit, retrying only while the registry cannot be reached.
 *
 * `run` is injected so the retry policy is testable without a network: every
 * branch below is reachable from a list of canned outcomes.
 *
 * @param {{ run?: () => { status: number|null, stdout: string, stderr: string },
 *           sleep?: (ms: number) => void,
 *           log?: (line: string) => void }} deps
 */
export function audit(deps = {}) {
  const run = deps.run ?? runPnpmAudit;
  const sleep = deps.sleep ?? sleepSync;
  const log = deps.log ?? ((l) => console.log(l));

  let last = { kind: 'unknown', detail: 'no attempt was made' };
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    last = classify(run());
    // Anything but a transport failure is an answer. Stop asking.
    if (last.kind !== 'unreachable') break;
    if (attempt < ATTEMPTS) {
      const wait = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      log(
        `check:security: could not reach the registry (${last.marker}) — ` +
          `attempt ${attempt} of ${ATTEMPTS}, retrying in ${wait / 1000}s`
      );
      sleep(wait);
    }
  }
  return last;
}

/**
 * The line the gate prints, and the exit code that goes with it.
 *
 * 🔴 Every branch says which of the three things happened — audited and clean,
 * audited and found something, or did not audit. "Did not audit" passing is
 * only safe because it is impossible to mistake for "audited and clean" in the
 * log, so the message is the safety property, not decoration.
 *
 * @returns {{ code: number, lines: string[] }}
 */
export function report(result) {
  switch (result.kind) {
    case 'clean':
      return { code: 0, lines: ['check:security: no known vulnerabilities'] };
    case 'findings': {
      const detail = Object.entries(result.counts)
        .filter(([, n]) => n > 0)
        .map(([sev, n]) => `${n} ${sev}`)
        .join(', ');
      return {
        code: 1,
        lines: [
          `check:security: FOUND ${result.total} vulnerability/ies (${detail})`,
          'check:security: this is a real finding — `pnpm audit --prod` for the detail',
        ],
      };
    }
    case 'unreachable':
      return {
        code: 0,
        lines: [
          `check:security: SKIPPED — the registry could not be reached after ${ATTEMPTS} attempts (${result.marker}).`,
          'check:security: NOTHING WAS AUDITED. This is a transport failure, not a security finding,',
          'check:security: and it is passed deliberately so a slow endpoint cannot fail a release.',
        ],
      };
    default:
      return {
        code: 1,
        lines: [
          `check:security: FAILED for a reason this wrapper does not recognise: ${result.detail}`,
          'check:security: not treated as a network problem, because it cannot be shown to be one.',
        ],
      };
  }
}

function runPnpmAudit() {
  const r = spawnSync('pnpm', ['audit', '--prod', '--json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: `${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`,
  };
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Entry point only when run directly, so the suite can import the parts above
// without spawning a real audit. Compared as resolved absolute paths: matching
// on the basename would also fire when some other `check-security.mjs` is the
// entry, and a symlinked bin would miss.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { code, lines } = report(audit());
  for (const line of lines) console.log(line);
  process.exit(code);
}
