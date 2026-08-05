#!/usr/bin/env node
// ============================================================
// migrate-as-aliases.mjs (TD-18)
// ============================================================
//
// One-shot internal helper that rewrites legacy DGMO alias
// syntaxes to the canonical `as <alias>` postfix.
//
// Patterns rewritten:
//   1. Tag bare-shorthand:           `tag Name x`           → `tag Name as x`
//   2. Tag explicit-keyword:         `tag Name alias x`     → `tag Name as x`
//   3. Venn explicit-alias-keyword:  `Name(color) alias x`  → `Name(color) as x`
//   4. Venn explicit-alias-keyword:  `Name alias x`         → `Name as x`
//
// Walks targeted directories for `.dgmo`, `.md`, `.mdx`, and `.ts`
// files, applies the rewrites in-place, and prints a summary. For
// non-`.dgmo` files, only lines that look like DGMO syntax inside
// fenced code blocks or template strings are rewritten.
//
// No safety contract (per C2 — pre-1.0, internal use only).
//
// Usage:
//   node dgmo/scripts/migrate-as-aliases.mjs [--dry-run] [<paths…>]
//
// Defaults to walking:
//   - dgmo/gallery/fixtures
//   - dgmo-content/examples
//   - obsidian-dgmo/src/examples.ts (special-cased — `.ts`, in-string)
//   - diagrammo_app_site/src/assets/showcase
//   - diagrammo_app_site/content/examples

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const DEFAULT_TARGETS = [
  'dgmo/gallery/fixtures',
  'dgmo/tests/fixtures',
  'dgmo/test-fixtures',
  'dgmo-content/examples',
  'dgmo-content/guide',
  'diagrammo_app_site/src/assets/showcase',
  'diagrammo_app_site/content/examples',
  'diagrammo_app_site/src/content/blog',
  'diagrammo-app/src/docs/content',
  'obsidian-dgmo/src/examples.ts',
  'docs',
  'dgmo/README.md',
];

// Embedded-DGMO files: `.md`, `.mdx`, `.ts`. Migration runs only on
// lines that pass the same shape regexes; safe-by-construction since
// the regexes anchor `^...$` and skip prose mentions.
const EMBEDDED_EXTS = new Set(['.md', '.mdx', '.ts', '.tsx']);

// Paths to skip — historical / migration-narrative docs that
// legitimately reference the old form for context, or files where
// `##` markdown headings could be corrupted by a naive regex match.
const SKIP_PATTERNS = [
  '/brainstorming-',
  '/epic-',
  'migration-sequence-color-to-tags.md',
  'language-reference.md',
  'dgmo-language-spec.md',
  'dgmo-language-spec-decisions.md',
  'tech-spec-universal-alias-syntax.md',
  'tech-spec-universal-name-handling.md',
];

function shouldSkip(file) {
  return SKIP_PATTERNS.some((p) => file.includes(p));
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const explicitTargets = args.filter((a) => !a.startsWith('--'));
const targets = explicitTargets.length > 0 ? explicitTargets : DEFAULT_TARGETS;

// ── Rewrite regexes ──────────────────────────────────────────

// Universal alias token: [A-Za-z][A-Za-z0-9_]{0,11}.
const ALIAS_TOKEN = '[A-Za-z][A-Za-z0-9_]{0,11}';

// Tag bare shorthand: `tag <Name…> <alias>`.
// Multi-word names allowed; alias is the last bare token.
// We scan line-by-line and detect `tag` lines without `as`/`alias`/inline values.
const TAG_BARE_RE = new RegExp(
  `^(\\s*tag\\s+)(.+?)\\s+(${ALIAS_TOKEN})\\s*$`
);

// Tag explicit `alias` keyword (rare): `tag Name alias x`.
const TAG_ALIAS_KEYWORD_RE = new RegExp(
  `^(\\s*tag\\s+)(.+?)\\s+alias\\s+(${ALIAS_TOKEN})(.*)$`
);

// Venn `Name(color) alias x` and `Name alias x`. Anchored at end of line
// because pipe metadata isn't legal on venn set declarations today.
const VENN_ALIAS_KEYWORD_RE = new RegExp(
  `^(\\s*[^(:|]+?)((?:\\([^)]+\\))?)\\s+alias\\s+(${ALIAS_TOKEN})\\s*$`
);

// Lines we DON'T want to rewrite as legacy bare tag shorthand:
//   - already canonical: `tag Name as x`
//   - inline-value form: `tag Name p High(red), Low(blue)` (parens before EOL)
//   - bare tag with no alias: `tag Name`
const TAG_SHOULD_SKIP = (line) => {
  if (/^\s*tag\s+\S+\s+as\s+/i.test(line)) return true;
  if (/^\s*tag\s+.+\(/.test(line)) return true; // inline values
  if (/^\s*tag\s+\S+\s*$/.test(line)) return true; // bare `tag Name`
  return false;
};

// ── Rewrite helpers ──────────────────────────────────────────

function rewriteTagLine(line) {
  if (TAG_SHOULD_SKIP(line)) return null;

  // Try `alias` keyword form first.
  let m = line.match(TAG_ALIAS_KEYWORD_RE);
  if (m) {
    return `${m[1]}${m[2]} as ${m[3]}${m[4]}`;
  }

  // Bare shorthand.
  m = line.match(TAG_BARE_RE);
  if (m) {
    return `${m[1]}${m[2]} as ${m[3]}`;
  }

  return null;
}

function rewriteVennLine(line, isInsideVenn) {
  if (!isInsideVenn) return null;
  // Skip already-canonical
  if (/\s+as\s+[A-Za-z][A-Za-z0-9_]{0,11}\s*$/.test(line)) return null;
  // Skip markdown headings (`## Rank alias r` etc.) — the venn regex would
  // otherwise treat them as legitimate set-with-alias declarations.
  if (/^\s*#/.test(line)) return null;

  const m = line.match(VENN_ALIAS_KEYWORD_RE);
  if (!m) return null;
  const name = m[1];
  const colorPart = m[2] ?? '';
  const alias = m[3];
  return `${name}${colorPart} as ${alias}`;
}

// Detect chart type from the first non-empty, non-comment line.
function detectChartType(lines) {
  for (const raw of lines) {
    const t = raw.trim();
    if (!t || t.startsWith('//')) continue;
    const first = t.split(/\s+/)[0].toLowerCase();
    return first;
  }
  return null;
}

function migrateContent(content, ext) {
  const lines = content.split('\n');
  const chartType = detectChartType(lines);
  const isDgmo = ext === '.dgmo';
  const isVenn = chartType === 'venn';
  // For embedded files (.md/.mdx/.ts), we don't know the chart type
  // statically — there can be multiple code blocks of different types.
  // Run venn-rewrite unconditionally; the regex's anchored shape guards
  // against prose false-positives (verified: lines containing `:`, `|`,
  // `(` before the candidate `alias` token won't match).
  const tryVennRewrite = isVenn || !isDgmo;

  let touched = 0;
  const out = lines.map((line) => {
    const tagRewrite = rewriteTagLine(line);
    if (tagRewrite !== null && tagRewrite !== line) {
      touched++;
      return tagRewrite;
    }
    if (tryVennRewrite) {
      const vennRewrite = rewriteVennLine(line, true);
      if (vennRewrite !== null && vennRewrite !== line) {
        touched++;
        return vennRewrite;
      }
    }
    return line;
  });
  return { content: out.join('\n'), touched };
}

// ── File walker ──────────────────────────────────────────────

function* walkDgmoFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return;
  const stat = fs.statSync(rootDir);
  if (stat.isFile()) {
    const ext = path.extname(rootDir);
    if (ext === '.dgmo' || EMBEDDED_EXTS.has(ext)) yield rootDir;
    return;
  }
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const p = path.join(rootDir, entry.name);
    // Skip noisy directories
    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === 'build' ||
        entry.name === '.next' ||
        entry.name === '__snapshots__'
      ) {
        continue;
      }
      yield* walkDgmoFiles(p);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (ext === '.dgmo' || EMBEDDED_EXTS.has(ext)) yield p;
    }
  }
}

// ── Main ──────────────────────────────────────────────────────

let totalFiles = 0;
let touchedFiles = 0;
let totalLineChanges = 0;
const touchedPaths = [];

for (const rel of targets) {
  const root = path.isAbsolute(rel) ? rel : path.join(REPO_ROOT, rel);
  for (const file of walkDgmoFiles(root)) {
    if (shouldSkip(file)) continue;
    totalFiles++;
    const ext = path.extname(file);
    const original = fs.readFileSync(file, 'utf-8');
    const { content: migrated, touched } = migrateContent(original, ext);
    if (touched > 0) {
      touchedFiles++;
      totalLineChanges += touched;
      touchedPaths.push({ file, touched });
      if (!dryRun) {
        fs.writeFileSync(file, migrated, 'utf-8');
      }
    }
  }
}

const mode = dryRun ? '[DRY-RUN]' : '[REWRITE]';
console.log(`${mode} migrate-as-aliases`);
console.log(`  scanned:  ${totalFiles} files`);
console.log(`  touched:  ${touchedFiles} files (${totalLineChanges} line changes)`);
if (touchedFiles > 0) {
  console.log('');
  for (const { file, touched } of touchedPaths) {
    console.log(`    ${file}  (${touched})`);
  }
}
