// plan() decides which tests a push runs (#2478). Run: node --test scripts/affected-tests.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from './affected-tests.mjs';

const tests = new Map([
  ['tests/polar.test.ts', "import { render } from '../src/render';"],
  [
    'tests/language-reference-examples.test.ts',
    "readFileSync('docs/language-reference.md')",
  ],
  ['tests/stress-corpus.test.ts', "const dir = join(root, 'stress/');"],
  ['tests/changelog-assemble.test.ts', "join('changelog.d/', name)"],
  ['tests/fixture-user.test.ts', "readFileSync('tests/fixtures/org-big.dgmo')"],
]);

test('a src change seeds the import walk and names no extra test', () => {
  assert.deepEqual(plan(['src/charts-d3/polar.ts'], tests), {
    mode: 'related',
    files: ['src/charts-d3/polar.ts'],
  });
});

test('a changed test file is passed through, so it runs itself', () => {
  assert.deepEqual(plan(['tests/polar.test.ts'], tests).files, [
    'tests/polar.test.ts',
  ]);
});

test('a docs change runs every test that names docs/', () => {
  const p = plan(
    ['src/sequence/parser.ts', 'docs/language-reference.md'],
    tests
  );
  assert.equal(p.mode, 'related');
  assert.deepEqual(p.files, [
    'src/sequence/parser.ts',
    'tests/language-reference-examples.test.ts',
  ]);
});

test('a changelog fragment runs the changelog test only', () => {
  assert.deepEqual(plan(['changelog.d/2458-polar.md'], tests).files, [
    'tests/changelog-assemble.test.ts',
  ]);
});

test('a fixture runs the test that reads it, by basename', () => {
  assert.ok(
    plan(['tests/fixtures/org-big.dgmo'], tests).files.includes(
      'tests/fixture-user.test.ts'
    )
  );
});

test('a stress fixture runs the stress corpus', () => {
  assert.ok(
    plan(['stress/sankey/wide.dgmo'], tests).files.includes(
      'tests/stress-corpus.test.ts'
    )
  );
});

for (const f of [
  'package.json',
  'pnpm-lock.yaml',
  'vitest.config.ts',
  'vitest.growth.config.ts',
  'tsconfig.json',
  'tests/setup.ts',
]) {
  test(`${f} forces the full suite`, () => {
    assert.equal(plan(['src/charts-d3/polar.ts', f], tests).mode, 'full');
  });
}

test('a file no test names and no code runs nothing', () => {
  assert.equal(
    plan(['api-baseline/index.d.ts', '.github/workflows/ci.yml'], tests).mode,
    'none'
  );
});
