#!/usr/bin/env node
// changelog-assemble.mjs — fold changelog.d/*.md into CHANGELOG.md under a
// new version heading, then delete the fragments (diagrammo/diagrammo#2340).
//
// Why fragments: CHANGELOG.md was edited by two or more landings on 19 of 31
// days (2026-10-25..11-25). Every such landing forced a rebase, and a rebase
// voids the verify receipt. One new file per change never conflicts.
//
// A fragment is plain Keep a Changelog markdown: one or more `### <Section>`
// headings (Added, Changed, Deprecated, Removed, Fixed, Security) with
// entries under them. Text before the first heading files under Changed.
// `changelog.d/README.md` is not a fragment.
//
// An `## [Unreleased]` section left in CHANGELOG.md is folded in too, first,
// so a hand edit there is released rather than stranded above the new heading.
//
// No fragments and no Unreleased text: CHANGELOG.md is left as it is, exit 0.
//
// Run by scripts/release.sh in the workspace root, after the version bump:
//   node scripts/changelog-assemble.mjs <version> [--date YYYY-MM-DD] [--dir <repo>]

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRAGMENT_DIR = 'changelog.d';
export const SECTION_ORDER = [
  'Added',
  'Changed',
  'Deprecated',
  'Removed',
  'Fixed',
  'Security',
];
const DEFAULT_SECTION = 'Changed';
const UNRELEASED = /^## \[Unreleased\][^\n]*$/im;

/** Split one fragment's text into { section: [entry text, …] }. */
export function parseFragment(text) {
  const out = new Map();
  let section = DEFAULT_SECTION;
  let buf = [];
  const flush = () => {
    const body = buf.join('\n').trim();
    if (body) out.set(section, [...(out.get(section) ?? []), body]);
    buf = [];
  };
  for (const line of text.split('\n')) {
    const m = /^###\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      section = m[1];
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/**
 * Pure assembly. `fragments` is a list of fragment texts in release order.
 * Returns the new CHANGELOG text, or null when there is nothing to release.
 */
export function assemble(changelog, fragments, version, date) {
  let text = changelog;
  const sources = [];
  const head = UNRELEASED.exec(text);
  if (head) {
    const start = head.index;
    const bodyStart = start + head[0].length;
    const rest = text.slice(bodyStart);
    const next = rest.search(/^## /m);
    const bodyEnd = next === -1 ? text.length : bodyStart + next;
    sources.push(text.slice(bodyStart, bodyEnd));
    text = text.slice(0, start) + text.slice(bodyEnd);
  }
  sources.push(...fragments);

  const sections = new Map();
  for (const src of sources) {
    for (const [name, entries] of parseFragment(src)) {
      sections.set(name, [...(sections.get(name) ?? []), ...entries]);
    }
  }
  if (sections.size === 0) return head ? text : null;

  const names = [
    ...SECTION_ORDER.filter((n) => sections.has(n)),
    ...[...sections.keys()].filter((n) => !SECTION_ORDER.includes(n)),
  ];
  const block =
    `## [${version}] - ${date}\n\n` +
    names
      .map((n) => `### ${n}\n\n${sections.get(n).join('\n\n')}\n`)
      .join('\n') +
    '\n';

  const first = text.search(/^## /m);
  if (first === -1)
    return text.replace(/\n*$/, '\n\n') + block.replace(/\n+$/, '\n');
  return text.slice(0, first) + block + text.slice(first);
}

/** File-level assembly in `dir`. Returns the fragment files it removed. */
export function assembleDir(dir, version, date) {
  const changelogPath = join(dir, 'CHANGELOG.md');
  const fragDir = join(dir, FRAGMENT_DIR);
  const files = existsSync(fragDir)
    ? readdirSync(fragDir)
        .filter((f) => f.endsWith('.md') && f !== 'README.md')
        .sort()
    : [];
  const before = readFileSync(changelogPath, 'utf8');
  const after = assemble(
    before,
    files.map((f) => readFileSync(join(fragDir, f), 'utf8')),
    version,
    date
  );
  if (after === null) return [];
  if (after !== before) writeFileSync(changelogPath, after);
  for (const f of files) rmSync(join(fragDir, f));
  return files;
}

function main(argv) {
  const args = [...argv];
  let date = new Date().toISOString().slice(0, 10);
  let dir = resolve(fileURLToPath(new URL('..', import.meta.url)));
  let version;
  while (args.length) {
    const a = args.shift();
    if (a === '--date') date = args.shift();
    else if (a === '--dir') dir = resolve(args.shift());
    else version = a;
  }
  if (
    !version ||
    !/^\d+\.\d+\.\d+/.test(version) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    console.error(
      'usage: changelog-assemble.mjs <version> [--date YYYY-MM-DD] [--dir <repo>]'
    );
    return 2;
  }
  const removed = assembleDir(dir, version, date);
  console.log(
    removed.length
      ? `changelog: ${removed.length} fragment(s) folded into CHANGELOG.md under ${version}`
      : 'changelog: no fragments in changelog.d/, CHANGELOG.md unchanged'
  );
  return 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main(process.argv.slice(2)));
}
