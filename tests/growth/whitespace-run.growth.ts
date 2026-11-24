// The whitespace-run regex sweep (diagrammo/diagrammo#2281). Nightly on anchor
// only: `pnpm test:growth`, from scripts/nightly-gate.sh in the workspace repo.
//
// A lazy group followed by `\s+` / `\s*`, or a pattern that starts with an
// unanchored `\s+`, rescans a long whitespace run from every position, so one
// line of `x` + n spaces + `y` costs O(n²) in that regex. The fix is a
// `(?<!\s)` in front of the `\s`, so the run is entered only at its start.
//
// This sweep finds such regexes without knowing where they are: for every
// gallery fixture line it widens one inner space to a LARGE run, parses the
// file, and times each RegExp call by wrapping `exec` (match, test, replace and
// split all go through it). Each regex's costliest call is then re-timed alone
// with `measureGrowth`, its run cut to SMALL and LARGE spaces, so a GC pause or
// a load burst during the parse cannot fail it.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDgmo } from '../../src/dgmo-router';
import { measureGrowth } from '../perf-helpers';

const FIXTURES = `${__dirname}/../../gallery/fixtures`;
const SMALL = 1000;
const LARGE = 4000;
const RUN = ' '.repeat(LARGE);
const LIMIT = 1.5;
/** A call cheaper than this at LARGE cannot matter, whatever its exponent. */
const FLOOR_MS = 2;

interface Call {
  re: RegExp;
  input: string;
  lastIndex: number;
  ms: number;
}

const realExec = RegExp.prototype.exec;

/** Every regex called during `fn`, keyed by source, with its costliest call. */
function regexCalls(fn: () => void): Map<string, Call> {
  const calls = new Map<string, Call>();
  RegExp.prototype.exec = function (this: RegExp, input: string) {
    const lastIndex = this.lastIndex;
    const started = performance.now();
    const result = realExec.call(this, input);
    const ms = performance.now() - started;
    const key = String(this);
    const prev = calls.get(key);
    if (!prev || prev.ms < ms) {
      calls.set(key, { re: this, input: String(input), lastIndex, ms });
    }
    return result;
  } as typeof RegExp.prototype.exec;
  try {
    fn();
  } finally {
    RegExp.prototype.exec = realExec;
  }
  return calls;
}

function parseQuietly(source: string): void {
  try {
    parseDgmo(source);
  } catch {
    // A parser that throws on the widened line still ran its regexes.
  }
}

/**
 * The fixture with one line widened by an n-space run: at every inner space,
 * and splitting the line's first and last words, so a run inside a name
 * (`crew   members`) is tried as well as one between tokens.
 */
function variants(lines: string[]): ((n: number) => string)[] {
  const out: ((n: number) => string)[] = [];
  lines.forEach((line, i) => {
    const m = /^(\s*)(\S.*\S)$/.exec(line);
    if (!m) return;
    const [, indent, body] = m;
    const cuts: [number, number][] = [];
    for (let ix = body.indexOf(' '); ix > 0; ix = body.indexOf(' ', ix + 1)) {
      cuts.push([ix, ix + 1]);
    }
    const first = /^\S+/.exec(body)![0];
    const last = /\S+$/.exec(body)![0];
    if (first.length >= 2) cuts.push([first.length >> 1, first.length >> 1]);
    if (last.length >= 2 && last !== body) {
      const at = body.length - last.length + (last.length >> 1);
      cuts.push([at, at]);
    }
    for (const [from, to] of cuts) {
      out.push((n) => {
        const copy = lines.slice();
        copy[i] = indent + body.slice(0, from) + ' '.repeat(n) + body.slice(to);
        return copy.join('\n');
      });
    }
  });
  return out;
}

describe('whitespace-run regex sweep', () => {
  it(`no regex grows faster than n^${LIMIT} on a long space run`, () => {
    const slow = new Map<string, string>();
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.dgmo'));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const lines = readFileSync(`${FIXTURES}/${file}`, 'utf8').split('\n');
      for (const build of variants(lines)) {
        const large = regexCalls(() => parseQuietly(build(LARGE)));
        for (const [key, big] of large) {
          if (big.ms < FLOOR_MS || slow.has(key)) {
            continue;
          }
          // Re-time this one call alone, with its run cut back to n spaces.
          const at = big.input.indexOf(RUN);
          if (at < 0) continue;
          const re = new RegExp(big.re.source, big.re.flags);
          const k = measureGrowth({
            small: SMALL,
            large: LARGE,
            prepare: (n) => ({
              input:
                big.input.slice(0, at) +
                ' '.repeat(n) +
                big.input.slice(at + LARGE),
              lastIndex:
                big.lastIndex > at ? big.lastIndex - LARGE + n : big.lastIndex,
            }),
            run: (call) => {
              re.lastIndex = call.lastIndex;
              return realExec.call(re, call.input);
            },
            limit: LIMIT,
          });
          if (k >= LIMIT) slow.set(key, `${file} (k=${k.toFixed(2)})`);
        }
      }
    }

    expect(
      [...slow].map(([re, where]) => `${re}  ← ${where}`),
      'regexes quadratic on a whitespace run: put (?<!\\s) before the \\s'
    ).toEqual([]);
  });
});
