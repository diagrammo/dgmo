#!/usr/bin/env node

// Fail before the expensive render/API gates when pnpm's installed dependency
// tree is not the tree committed in pnpm-lock.yaml. pnpm copies the lockfile it
// actually installed into node_modules/.pnpm/lock.yaml; a non-frozen update can
// change that copy without changing the committed file.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.DGMO_INSTALL_LOCK_ROOT ?? process.cwd();
const committedPath = join(root, 'pnpm-lock.yaml');
const installedPath = join(root, 'node_modules', '.pnpm', 'lock.yaml');

if (!existsSync(committedPath)) {
  console.error(
    '✗ pnpm-lock.yaml is missing; the installed tree cannot be verified.'
  );
  process.exit(1);
}

if (!existsSync(installedPath)) {
  console.error('✗ node_modules has no pnpm install record.');
  console.error('  Run: pnpm install --frozen-lockfile');
  process.exit(1);
}

const committed = readFileSync(committedPath);
const installed = readFileSync(installedPath);

if (!committed.equals(installed)) {
  console.error('✗ installed dependencies do not match pnpm-lock.yaml.');
  console.error(
    '  Inspect: diff -u pnpm-lock.yaml node_modules/.pnpm/lock.yaml'
  );
  console.error('  Repair:  pnpm install --frozen-lockfile');
  console.error(
    '  Do not re-baseline API or gallery output from this dependency tree.'
  );
  process.exit(1);
}

console.log('✓ installed dependencies match pnpm-lock.yaml.');
