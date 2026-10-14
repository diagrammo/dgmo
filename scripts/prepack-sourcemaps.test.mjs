import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Pins the prepack guard from #667: before it, every published .js pointed at
// a map no `files` list shipped, and every Vite consumer logged an error per
// chunk. Nothing else in check:all notices a dangling comment — publint does not.
const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  'prepack-sourcemaps.mjs'
);

const A_JS = 'export const a = 1;\n//# sourceMappingURL=a.js.map\n';
const B_JS = 'export const b = 2;\n//# sourceMappingURL=b.js.map\n';

/** A temp package: `pkg` is its package.json, `files` maps rel path → text. */
const makePackage = (t, pkg, files) => {
  const dir = mkdtempSync(join(tmpdir(), 'prepack-sourcemaps-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.0.0', ...pkg })
  );
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
};

const run = (dir) =>
  spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });

const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');

const BUILT = {
  'dist/a.js': A_JS,
  'dist/a.js.map': '{}',
  'dist/b.js': B_JS,
  'dist/b.js.map': '{}',
};

test('strips every comment whose map the files list does not publish', (t) => {
  const dir = makePackage(t, { files: ['dist/*.js'] }, BUILT);
  const res = run(dir);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(read(dir, 'dist/a.js'), 'export const a = 1;\n');
  assert.equal(read(dir, 'dist/b.js'), 'export const b = 2;\n');
});

test('leaves the comments alone when the maps are published', (t) => {
  const dir = makePackage(t, { files: ['dist'] }, BUILT);
  const res = run(dir);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(read(dir, 'dist/a.js'), A_JS);
  assert.equal(read(dir, 'dist/b.js'), B_JS);
});

test('keeps the comment of a published map and strips the other', (t) => {
  const dir = makePackage(t, { files: ['dist/*.js', 'dist/a.js.map'] }, BUILT);
  const res = run(dir);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(read(dir, 'dist/a.js'), A_JS);
  assert.equal(read(dir, 'dist/b.js'), 'export const b = 2;\n');
});

for (const entry of ['!dist/b.js', 'dist/**/*.js', 'dist/*/a.js']) {
  test(`refuses the files entry ${entry} and names it`, (t) => {
    const dir = makePackage(t, { files: ['dist/*.js', entry] }, BUILT);
    const res = run(dir);
    assert.equal(res.status, 1);
    assert.ok(res.stderr.includes(JSON.stringify(entry)), res.stderr);
    assert.equal(read(dir, 'dist/a.js'), A_JS);
  });
}

test('refuses a package with no files list', (t) => {
  const dir = makePackage(t, {}, BUILT);
  const res = run(dir);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /no "files" allowlist/);
  assert.equal(read(dir, 'dist/a.js'), A_JS);
});
