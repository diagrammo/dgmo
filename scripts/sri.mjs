#!/usr/bin/env node
// Compute SRI sha384 hashes for the auto-bundle artifacts and print
// copy-pasteable <script>/<link> snippets for the release notes.
//
// Usage:
//   node scripts/sri.mjs                # prints to stdout
//   node scripts/sri.mjs --markdown     # markdown-formatted block

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const PKG = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const VERSION = PKG.version;
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@diagrammo/dgmo@${VERSION}/dist`;

const ARTIFACTS = [
  { file: 'auto.js', tag: 'script' },
  { file: 'auto.css', tag: 'link' },
];

function sri(filePath) {
  const buf = readFileSync(filePath);
  const hash = createHash('sha384').update(buf).digest('base64');
  return `sha384-${hash}`;
}

const useMarkdown = process.argv.includes('--markdown');
const lines = [];

if (useMarkdown) {
  lines.push(`### SRI hashes for @diagrammo/dgmo@${VERSION}`);
  lines.push('');
  lines.push('```html');
}

for (const { file, tag } of ARTIFACTS) {
  const path = resolve(DIST, file);
  if (!existsSync(path)) continue;
  const integrity = sri(path);
  if (tag === 'script') {
    lines.push(
      `<script src="${CDN_BASE}/${file}" integrity="${integrity}" crossorigin="anonymous"></script>`
    );
  } else {
    lines.push(
      `<link rel="stylesheet" href="${CDN_BASE}/${file}" integrity="${integrity}" crossorigin="anonymous">`
    );
  }
}

if (useMarkdown) {
  lines.push('```');
}

process.stdout.write(lines.join('\n') + '\n');
