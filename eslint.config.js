import js from '@eslint/js';
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const localPlugin = require('./eslint-plugin-local');

export default tseslint.config(
  { ignores: ['dist', 'scripts', 'test-fixtures', 'eslint-plugin-local', 'gallery', 'api-baseline'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      // Epic 105 Tier E modernization rules. Active at 'warn' to surface
      // violations without blocking CI; convert to 'error' after a focused
      // pass through the remaining ~130 sites (101 || → ??, 22 inline
      // import() → import type, 8 manual optional-chain conversions).
      // 44 auto-fixable cases were resolved opportunistically alongside
      // enabling the rules (commit landing this).
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'warn',
      '@typescript-eslint/consistent-type-imports': 'warn',
      // Disable noisy type-checked rules that don't catch real bugs
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-implied-eval': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  security.configs.recommended,
  {
    rules: {
      'security/detect-object-injection': 'off',
      // Parser regexes process local diagram markup, not untrusted network input
      'security/detect-unsafe-regex': 'off',
      // Parser builds regexes from known strings, not user-supplied patterns
      'security/detect-non-literal-regexp': 'off',
      // String comparisons in parsers are not timing-sensitive
      'security/detect-possible-timing-attacks': 'off',
      // CLI and tests read files from known paths
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  // Disable type-checked linting for files outside tsconfig
  {
    files: ['**/*.config.ts', 'tests/**/*.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
  // Universal Name Handling guardrail — see eslint-plugin-local/rules/.
  // Phase B migrated every parser insertion site through normalizeName /
  // getOrCreateName; the rule is now an error so future insertions can't
  // silently re-introduce phantom-entity bugs.
  {
    files: ['src/**/*.ts'],
    plugins: { 'name-normalize': localPlugin },
    rules: { 'name-normalize/required-at-insertion': 'error' },
  }
);
