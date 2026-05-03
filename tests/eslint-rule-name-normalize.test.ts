import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const localPlugin: {
  rules: Record<string, unknown>;
} = require('../eslint-plugin-local');

// Filename has to look like a parser file for the rule to fire.
// Repo-relative filenames — ESLint flat config's Linter rejects
// absolute paths it doesn't recognize, but accepts relative ones.
// Extension is `.js` so the default parser can consume snippets;
// the rule's path regex matches both .ts and .js.
const PARSER_FILENAME = 'src/sequence/parser.js';
const NON_PARSER_FILENAME = 'src/utils/helpers.js';

function lint(code: string, filename = PARSER_FILENAME) {
  const linter = new Linter();
  return linter.verify(
    code,
    {
      plugins: { 'name-normalize': localPlugin },
      rules: { 'name-normalize/required-at-insertion': 'error' },
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    { filename }
  );
}

describe('name-normalize/required-at-insertion', () => {
  it('fires on bare Map.set into nodeMap', () => {
    const results = lint(`
      const nodeMap = new Map();
      nodeMap.set(name, { kind: 'node' });
    `);
    expect(results).toHaveLength(1);
    expect(results[0].messageId).toBe('missingNormalize');
  });

  it('fires on bare Set.add into participantIds', () => {
    const results = lint(`
      const participantIds = new Set();
      participantIds.add(name);
    `);
    expect(results).toHaveLength(1);
    expect(results[0].messageId).toBe('missingNormalize');
  });

  it('passes when first arg is normalizeName(...)', () => {
    const results = lint(`
      const nodeMap = new Map();
      nodeMap.set(normalizeName(name), { kind: 'node' });
    `);
    expect(results).toHaveLength(0);
  });

  it('passes when first arg is getOrCreateName(...) result', () => {
    const results = lint(`
      const nodeMap = new Map();
      nodeMap.set(getOrCreateName(name, store, line).entry.normalizedKey, value);
    `);
    expect(results).toHaveLength(0);
  });

  it('passes when first arg is *.normalizedKey member access', () => {
    const results = lint(`
      const nodeMap = new Map();
      nodeMap.set(entry.normalizedKey, value);
    `);
    expect(results).toHaveLength(0);
  });

  it('passes when first arg is a conventional `key` variable', () => {
    const results = lint(`
      const nodeMap = new Map();
      const key = normalizeName(input);
      nodeMap.set(key, value);
    `);
    expect(results).toHaveLength(0);
  });

  it('does not fire on non-parser files', () => {
    const results = lint(
      `
      const nodeMap = new Map();
      nodeMap.set(name, value);
    `,
      NON_PARSER_FILENAME
    );
    expect(results).toHaveLength(0);
  });

  it('does not fire on a Map whose name does not match entity-storage suffix', () => {
    const results = lint(`
      const counters = new Map();
      counters.set(name, 1);
    `);
    expect(results).toHaveLength(0);
  });

  it('does not fire on Set.add for a non-entity Set', () => {
    const results = lint(`
      const seenLines = new Set();
      seenLines.add(line);
    `);
    expect(results).toHaveLength(0);
  });
});
