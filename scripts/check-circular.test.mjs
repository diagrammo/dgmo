import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalCycle,
  checkCircularDependencies,
} from './check-circular.mjs';

const ALLOWED = [
  'boxes-and-lines/layout.ts',
  'boxes-and-lines/layout-search.ts',
];

test('accepts the one known cycle regardless of Madge path order', () => {
  assert.deepEqual(checkCircularDependencies([ALLOWED]), {
    unexpected: [],
    missing: [],
  });
  assert.deepEqual(checkCircularDependencies([[...ALLOWED].reverse()]), {
    unexpected: [],
    missing: [],
  });
});

test('rejects a replacement cycle even when the cycle count stays one', () => {
  assert.deepEqual(checkCircularDependencies([['new/a.ts', 'new/b.ts']]), {
    unexpected: ['new/a.ts -> new/b.ts'],
    missing: [canonicalCycle(ALLOWED)],
  });
});

test('rejects an additional cycle', () => {
  assert.deepEqual(
    checkCircularDependencies([ALLOWED, ['new/a.ts', 'new/b.ts']]),
    {
      unexpected: ['new/a.ts -> new/b.ts'],
      missing: [],
    }
  );
});

test('requires an allowlist update when the known cycle is removed', () => {
  assert.deepEqual(checkCircularDependencies([]), {
    unexpected: [],
    missing: [canonicalCycle(ALLOWED)],
  });
});
