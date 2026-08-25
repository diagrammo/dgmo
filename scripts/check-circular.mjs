import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ALLOWED_CYCLES = [
  ['boxes-and-lines/layout-search.ts', 'boxes-and-lines/layout.ts'],
];

function rotations(cycle) {
  return cycle.map((_, index) => [
    ...cycle.slice(index),
    ...cycle.slice(0, index),
  ]);
}

export function canonicalCycle(cycle) {
  if (!Array.isArray(cycle) || cycle.length === 0) {
    throw new TypeError('Every circular dependency must be a non-empty path');
  }

  const forward = rotations(cycle);
  const reverse = rotations([...cycle].reverse());
  return [...forward, ...reverse].map((path) => path.join(' -> ')).sort()[0];
}

export function checkCircularDependencies(cycles) {
  if (!Array.isArray(cycles)) {
    throw new TypeError('Madge output must be a JSON array');
  }

  const expected = new Set(ALLOWED_CYCLES.map(canonicalCycle));
  const actual = new Set(cycles.map(canonicalCycle));
  const unexpected = [...actual].filter((cycle) => !expected.has(cycle));
  const missing = [...expected].filter((cycle) => !actual.has(cycle));

  return { unexpected, missing };
}

function main() {
  const cycles = JSON.parse(readFileSync('/dev/stdin', 'utf8'));
  const { unexpected, missing } = checkCircularDependencies(cycles);

  if (unexpected.length > 0 || missing.length > 0) {
    for (const cycle of unexpected) {
      console.error(`Unexpected circular dependency: ${cycle}`);
    }
    for (const cycle of missing) {
      console.error(`Allowed circular dependency disappeared: ${cycle}`);
      console.error(
        'Remove it from ALLOWED_CYCLES after verifying the cycle was intentionally fixed.'
      );
    }
    process.exitCode = 1;
    return;
  }

  if (cycles.length === 0) {
    console.log('No circular dependencies');
  } else {
    console.log(`Allowed circular dependency: ${canonicalCycle(cycles[0])}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
