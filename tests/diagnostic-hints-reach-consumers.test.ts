// A diagnostic's `hint` is the sentence that says how to fix the mistake, and
// until 2026-09-01 nothing but `dgmo diagnostics --json` could see one: `emit()`
// built its `DgmoError` from line, message, severity and code and never read
// `spec.hint`. 84 registry specs carry a hint; every one of them was written,
// reviewed and then discarded one function before any consumer could render it.
//
// These tests pin the wire, not the wording. If they fail, an editor somewhere
// silently went back to showing the terse message alone.
import { describe, it, expect } from 'vitest';
import { validate } from '../src/index';
import { emit, type DiagnosticSpec } from '../src/diagnostics';
import { listDiagnosticCodes } from '../src/diagnostics-registry';

const WITH_HINT: DiagnosticSpec = {
  code: 'E_TEST_HINTED',
  severity: 'error',
  chartType: null,
  title: 'test',
  message: 'Something is wrong.',
  hint: 'Do this instead.',
};
const WITHOUT_HINT: DiagnosticSpec = {
  code: 'E_TEST_BARE',
  severity: 'error',
  chartType: null,
  title: 'test',
  message: 'Something is wrong.',
};

describe('emit() carries the spec hint', () => {
  it('copies it when the spec has one', () => {
    expect(emit(WITH_HINT, 1).hint).toBe('Do this instead.');
  });

  it('leaves the field absent when the spec has none', () => {
    const err = emit(WITHOUT_HINT, 1);
    expect(err.hint).toBeUndefined();
    expect('hint' in err).toBe(false);
  });
});

describe('a hint survives a real parse', () => {
  it('reaches the consumer on E_VALUE_NEGATIVE', () => {
    const found = validate(
      'pie Budget\nRent 1200\nRefunds -300'
    ).diagnostics.find((d) => d.code === 'E_VALUE_NEGATIVE');
    expect(found).toBeDefined();
    expect(found!.hint).toContain('Restate the data as positive magnitudes');
  });

  // The sweep: for every spec that ships both a hint and a minimal example,
  // parse the example and — where the example really does raise that code —
  // require the hint to have travelled with it.
  it('reaches the consumer for every spec whose example triggers it', () => {
    const specs = listDiagnosticCodes().filter((s) => s.hint && s.example);
    const missing: string[] = [];
    let covered = 0;

    for (const spec of specs) {
      let diagnostics;
      try {
        diagnostics = validate(spec.example!).diagnostics;
      } catch {
        continue; // an example that cannot parse at all proves nothing here
      }
      const hit = diagnostics.find((d) => d.code === spec.code);
      if (!hit) continue; // the example no longer triggers its own code
      covered++;
      if (hit.hint !== spec.hint) missing.push(spec.code);
    }

    // 🔴 Without this the sweep passes when it covers nothing at all.
    expect(covered).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });
});
