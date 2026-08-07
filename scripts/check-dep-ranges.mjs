#!/usr/bin/env node
// Fail when a declared dependency range cannot reach the version that is
// actually published.
//
// 🔴 This exists because a caret on a 0.x version locks the MINOR. `^0.18.0`
// admits 0.18.x and nothing else, so the range keeps resolving cleanly, npm
// keeps reporting success, and the dependency silently sits releases behind.
// It had bitten four times before this check was written — the marketing site
// pinned ^0.44 against dgmo 0.61, dgmo-mcp pinned ^0.59 against dgmo 0.62, the
// CLI pinned ^0.17 against dgmo-mcp 0.18, and then the CLI sat on ^0.18.0
// through dgmo-mcp 0.19.0 and 0.20.x. That last one shipped: `brew install
// dgmo` installed a 0.18.0 MCP server, which still declared the library as a
// runtime dependency, so a CLI install measured 71.9 MB instead of 61.9 MB —
// the whole point of inlining the library, undone by one caret.
//
// The rule this enforces: inside this ecosystem, depend with `>=X <1`, not
// `^X`. Across the 0.x line we are one author with no external consumers, so
// admitting the next minor is right and excluding it is the bug.
//
// Reads the registry, so it needs a network. Offline, it says so and passes
// rather than failing a build for a reason unrelated to the change.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Every manifest this repo publishes from, plus the scope we govern. A range on
// a third-party package is not ours to widen, so only @diagrammo/* is checked.
const MANIFESTS = ['package.json', 'cli/package.json'];
const SCOPE = '@diagrammo/';

function npmView(spec, field) {
  try {
    const out = execFileSync('npm', ['view', spec, field], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // A range matching several versions prints one per line; take the highest,
    // which npm prints last.
    return out.trim().split('\n').filter(Boolean).pop()?.replace(/['"]/g, '');
  } catch {
    return undefined;
  }
}

let failures = 0;
let checked = 0;
let offline = false;

for (const manifest of MANIFESTS) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
  } catch {
    continue; // a manifest that does not exist on this branch is not an error
  }

  const deps = { ...pkg.dependencies, ...pkg.peerDependencies };
  for (const [name, range] of Object.entries(deps)) {
    if (!name.startsWith(SCOPE)) continue;
    if (/^(workspace:|link:|file:|\*$)/.test(range)) continue;

    const latest = npmView(name, 'version');
    if (!latest) {
      offline = true;
      continue;
    }
    const reachable = npmView(`${name}@${range}`, 'version');
    checked += 1;

    if (reachable !== latest) {
      failures += 1;
      console.error(
        `✗ ${manifest}: "${name}": "${range}" reaches ${reachable ?? 'nothing'}, ` +
          `but ${latest} is published.`
      );
      if (range.startsWith('^') && /^\^0\./.test(range)) {
        console.error(
          `  A caret on a 0.x locks the MINOR. Use ">=${latest} <1" instead of "${range}".`
        );
      }
    }
  }
}

if (offline && checked === 0) {
  console.log('· dependency ranges not checked — the registry was unreachable.');
  process.exit(0);
}

if (failures > 0) {
  console.error(`\n${failures} dependency range(s) cannot reach what is published.`);
  process.exit(1);
}

console.log(`✓ ${checked} @diagrammo dependency range(s) reach the published version.`);
