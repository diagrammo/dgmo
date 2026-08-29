// Synthetic-fixture test for migrate-as-aliases.mjs (TD-18).
// Run via: node dgmo/scripts/migrate-as-aliases.test.mjs
import { strict as assert } from 'node:assert';

// Inline the migrator so we don't fork to a subprocess.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, 'migrate-as-aliases.mjs');

function runOnFixture(content, ext = '.dgmo') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-as-aliases-'));
  const file = path.join(tmp, `fixture${ext}`);
  fs.writeFileSync(file, content, 'utf-8');
  execSync(`node "${SCRIPT}" "${tmp}"`);
  const out = fs.readFileSync(file, 'utf-8');
  fs.rmSync(tmp, { recursive: true });
  return out;
}

// Test that embedded code blocks in .md / .mdx / .ts files get rewritten.
{
  const before = `# Venn

\`\`\`dgmo
venn Test
Apples(red) alias a
Oranges(blue) alias o
\`\`\`

The legacy \`alias\` keyword was removed in TD-18.`;
  const after = runOnFixture(before, '.md');
  assert.match(
    after,
    /Apples\(red\) as a/,
    'embedded venn code block migrated'
  );
  assert.match(after, /Oranges\(blue\) as o/);
  // Prose mention is left intact (anchored regex doesn't match it).
  assert.match(after, /legacy `alias` keyword was removed/);
}

{
  const before = `// Plugin example
const example = \`venn Test
Apples alias a
Oranges alias o
\`;`;
  const after = runOnFixture(before, '.ts');
  assert.match(after, /Apples as a/, 'embedded TS template string migrated');
  assert.match(after, /Oranges as o/);
}

// Prose with `tag X alias y` mentioned inside parens should NOT be rewritten.
{
  const before = `- The \`alias\` keyword (e.g., \`tag Location alias l\`) is no longer valid.`;
  const after = runOnFixture(before, '.md');
  // Anchored regex requires the WHOLE line to be `tag … alias …` — prose mention is safe.
  assert.equal(after, before, 'prose mention with parens is left untouched');
}

// ── Tag bare-shorthand → as ──────────────────────────────────

{
  const before = `sequence
tag Priority p
  High(red), Low(blue)
Alice -> Bob`;
  const after = runOnFixture(before);
  assert.match(after, /tag Priority as p/, 'bare tag shorthand → as');
  assert.doesNotMatch(after, /^tag Priority p$/m);
}

// ── Tag explicit alias-keyword → as ──────────────────────────

{
  const before = `sequence
tag Priority alias p
  High(red), Low(blue)`;
  const after = runOnFixture(before);
  assert.match(after, /tag Priority as p/, 'tag alias keyword → as');
  assert.doesNotMatch(after, /tag Priority alias p/);
}

// ── Multi-word tag bare shorthand ────────────────────────────

{
  const before = `infra Web Stack
tag Risk Level lo
  High(red), Low(blue)`;
  const after = runOnFixture(before);
  assert.match(after, /tag Risk Level as lo/, 'multi-word tag bare shorthand');
}

// ── Venn alias keyword → as ──────────────────────────────────

{
  const before = `venn Sea Trades
Swordsmanship(red) alias sw
Navigation(blue) alias nav
sw + nav Sea Raiders`;
  const after = runOnFixture(before);
  assert.match(after, /Swordsmanship\(red\) as sw/, 'venn (color) alias → as');
  assert.match(after, /Navigation\(blue\) as nav/, 'venn (color) alias → as');
  assert.doesNotMatch(after, /\balias\b/);
}

// ── Venn alias without color ─────────────────────────────────

{
  const before = `venn Test
Apples alias a
Oranges alias o
a + o Cider`;
  const after = runOnFixture(before);
  assert.match(after, /Apples as a/);
  assert.match(after, /Oranges as o/);
}

// ── Already-canonical lines should be left alone ─────────────

{
  const before = `sequence
tag Priority as p
  High(red), Low(blue)
Alice is an actor as al
al -> Bob`;
  const after = runOnFixture(before);
  assert.equal(after, before, 'already-canonical input → unchanged');
}

// ── Bare `tag Name` with no alias should be left alone ───────

{
  const before = `sequence
tag Priority
  High(red), Low(blue)`;
  const after = runOnFixture(before);
  assert.equal(after, before, 'bare tag with no alias → unchanged');
}

// ── Inline-value tag should not be rewritten ─────────────────

{
  const before = `sequence
tag Priority p High(red), Low(blue)`;
  const after = runOnFixture(before);
  // Inline-value form is left alone — manual review needed.
  assert.equal(
    after,
    before,
    'tag with inline values → skipped (manual review)'
  );
}

console.log('migrate-as-aliases.test.mjs: all assertions passed');
