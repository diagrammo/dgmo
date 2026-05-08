#!/usr/bin/env node
/* eslint-disable */
/**
 * Bundle-size regression check.
 *
 * Reads dgmo/.bundle-baseline.json and the current dist/ output, then fails
 * if (current - baselineB) gzip size exceeds the recorded budget.
 *
 * baselineA: pre-PERT measurement (history; not enforced)
 * baselineB: post-infra/pre-PERT-module measurement (enforced floor)
 * budget   : ceiled-to-5KB delta from the bundle-delta spike (T0.3)
 *
 * If baselineB or budget is null, the script logs current sizes and exits 0
 * — that's the pre-Phase-1 setup state.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const repo = path.resolve(__dirname, '..');
const baselinePath = path.join(repo, '.bundle-baseline.json');
const distEsm = path.join(repo, 'dist', 'index.js');
const distCjs = path.join(repo, 'dist', 'index.cjs');

function gzipSize(filePath) {
  const buf = fs.readFileSync(filePath);
  return zlib.gzipSync(buf, { level: 9 }).length;
}

function fmt(bytes) {
  return `${bytes.toLocaleString()} B (${(bytes / 1024).toFixed(1)} KB)`;
}

function main() {
  if (!fs.existsSync(baselinePath)) {
    console.error(`Missing ${baselinePath}`);
    process.exit(1);
  }
  if (!fs.existsSync(distEsm) || !fs.existsSync(distCjs)) {
    console.error('Missing dist/index.{js,cjs}; run pnpm build first.');
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const current = {
    esm: { raw: fs.statSync(distEsm).size, gzip: gzipSize(distEsm) },
    cjs: { raw: fs.statSync(distCjs).size, gzip: gzipSize(distCjs) },
  };

  console.log('Current bundle sizes:');
  console.log(`  ESM raw=${fmt(current.esm.raw)} gzip=${fmt(current.esm.gzip)}`);
  console.log(`  CJS raw=${fmt(current.cjs.raw)} gzip=${fmt(current.cjs.gzip)}`);

  const { baselineB, budget } = baseline;
  if (!baselineB || budget == null) {
    console.log('\nbaselineB or budget not yet set in .bundle-baseline.json.');
    console.log('Skipping enforcement (pre-Phase-1 setup state).');
    return;
  }

  const deltaEsm = current.esm.gzip - baselineB.esm.gzip;
  const deltaCjs = current.cjs.gzip - baselineB.cjs.gzip;
  console.log(`\nDelta vs baselineB (gzip):`);
  console.log(`  ESM: ${deltaEsm >= 0 ? '+' : ''}${fmt(deltaEsm)}`);
  console.log(`  CJS: ${deltaCjs >= 0 ? '+' : ''}${fmt(deltaCjs)}`);
  console.log(`  Budget: ${fmt(budget)}`);

  const worst = Math.max(deltaEsm, deltaCjs);
  if (worst > budget) {
    console.error(
      `\nBundle-size budget exceeded: max delta ${fmt(worst)} > budget ${fmt(budget)}.`
    );
    process.exit(1);
  }
  console.log('\nBundle size within budget.');
}

main();
