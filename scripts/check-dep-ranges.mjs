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
// a third-party package is not ours to widen, so only @diagrammo/* is checked
// for REACHABILITY. Exactness is a separate rule with the opposite sign — see
// EXACT_PINS below.
const MANIFESTS = ['package.json', 'cli/package.json'];
const SCOPE = '@diagrammo/';

// 🔴 Third-party packages whose output the gallery snapshots ASSERT ON, and
// which must therefore be pinned exactly rather than by range.
//
// This is the inverse of the `>=X <1` rule above and is not a contradiction:
// that rule is about sibling @diagrammo packages, where admitting the next
// minor is right because we publish it. A layout engine is different — the 98
// gallery snapshots are the only thing asserting a chart is laid out correctly,
// and a range means dgmo's own lockfile can certify one version while every
// consumer resolves another.
//
// That is not hypothetical. `"@dagrejs/dagre": "^3.0.0"` had dgmo's lockfile on
// 3.0.0 while diagrammo-app, astro-dgmo and a fixture installing dgmo from npm
// all resolved 3.1.1 — measured 2026-08-28 (#519) — so the snapshots certified
// a layout nobody ran. Pinning to 3.1.1 moved exactly nine of them: flowchart
// (x4), class, er, infra, sitemap and state.
//
// 🔴 CI installing frozen is what ENTRENCHES such a split rather than catching
// it. Only an exact declared version makes every consumer resolve what we test.
const EXACT_PINS = new Set(['@dagrejs/dagre']);

function npmView(spec, field) {
  try {
    const out = execFileSync('npm', ['view', spec, field], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // A range matching several versions prints one per line; take the highest,
    // which npm prints last. In that multi-version form npm also prefixes each
    // line with `name@version `, so the field is the LAST whitespace-separated
    // token — not the whole line. Reading the line whole made this guard fail
    // the moment a range could reach two published versions, reporting
    // "@scope/pkg@0.21.0 0.21.0" as the version it had resolved.
    const line = out.trim().split('\n').filter(Boolean).pop();
    return line?.trim().split(/\s+/).pop()?.replace(/['"]/g, '');
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
    // Exactness is checked WITHOUT the registry, so it holds offline too — the
    // whole point is that this class of drift is invisible until someone
    // installs somewhere else.
    if (EXACT_PINS.has(name) && !/^\d+\.\d+\.\d+$/.test(range)) {
      failures += 1;
      console.error(
        `\u2717 ${manifest}: "${name}": "${range}" is a RANGE. The gallery ` +
          `snapshots assert this package's layout, so it must be an exact ` +
          `version or consumers resolve one we never test (#519).`
      );
    }
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

// 🔴 The offline pass must not swallow an EXACTNESS failure. That check reads
// only the manifest, so being unable to reach the registry says nothing about
// it — and this early exit would otherwise report a green build for the one
// class of drift that is invisible everywhere else.
if (offline && checked === 0 && failures === 0) {
  console.log(
    '· dependency ranges not checked — the registry was unreachable.'
  );
  process.exit(0);
}

if (failures > 0) {
  // Deliberately not "cannot reach what is published" — this script now
  // enforces two different rules and that wording named only one of them.
  console.error(`\n${failures} dependency range(s) failed.`);
  process.exit(1);
}

console.log(
  `✓ ${checked} @diagrammo dependency range(s) reach the published version.`
);
