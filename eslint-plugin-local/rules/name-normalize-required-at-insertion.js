'use strict';

// =====================================================================
// Rule: name-normalize/required-at-insertion
// =====================================================================
//
// Universal Name Handling guardrail. Fires when a chart-type parser
// inserts into an entity-storage Map/Set without first running the
// key through the shared `name-normalize` utility. Without this
// rule, a future contributor who forgets to call `normalizeName(...)`
// silently creates phantom entities — the bug class the spec was
// written to eliminate.
//
// Heuristic (intentionally conservative):
//   1. Only checks files matching the parser path pattern.
//   2. Only flags `.set(...)` / `.add(...)` on a receiver whose name
//      ends in Map / Set / Ids / Labels / ByKey (the conventional
//      entity-storage suffixes used across parsers today).
//   3. The first argument must look normalized — a call to
//      `normalizeName(...)` / `getOrCreateName(...)`, a member access
//      ending in `.normalizedKey`, or a variable conventionally named
//      `key` / `normalizedKey` / `normalized`.
//
// False positives are preferable to false negatives here — the spec
// makes this rule a hard requirement, not a stylistic suggestion.
// Suppress with `// eslint-disable-next-line name-normalize/required-at-insertion`
// at the rare insertion site that legitimately stores a non-name key.

// Path anchor accepts both absolute (`/repo/dgmo/src/...`) and
// repo-relative (`src/...`) forms — ESLint's flat-config Linter
// passes relative filenames to the rule.
//
// Extension-agnostic so the rule's own vitest tests (plain JS) can
// exercise it. CI only lints src/**/*.ts so the .js branch is
// unreachable in production.
const PARSER_PATH_RE =
  /(^|\/)src\/(sequence|graph|infra|c4|org|er|class|kanban|gantt|sitemap|boxes-and-lines)\/[^/]*parser[^/]*\.[tj]s$/;

const ENTITY_VAR_RE = /(Map|Set|Ids|Labels|ByKey)$/;

const NORMALIZED_VAR_NAMES = new Set([
  'key',
  'normalized',
  'normalizedKey',
  'normalizedName',
]);

function calleeName(node) {
  if (!node || node.type !== 'CallExpression') return null;
  if (node.callee.type === 'Identifier') return node.callee.name;
  if (
    node.callee.type === 'MemberExpression' &&
    node.callee.property.type === 'Identifier'
  ) {
    return node.callee.property.name;
  }
  return null;
}

function looksNormalized(node) {
  if (!node) return false;

  // normalizeName(...) / getOrCreateName(...) / displayName(...)
  const name = calleeName(node);
  if (name === 'normalizeName' || name === 'getOrCreateName' || name === 'displayName') {
    return true;
  }

  // *.normalizedKey member access
  if (
    node.type === 'MemberExpression' &&
    node.property.type === 'Identifier' &&
    node.property.name === 'normalizedKey'
  ) {
    return true;
  }

  // Conventional variable names — `const key = normalizeName(input)`
  if (node.type === 'Identifier' && NORMALIZED_VAR_NAMES.has(node.name)) {
    return true;
  }

  return false;
}

function receiverName(callee) {
  // map.set(...) → 'map'
  if (callee.object.type === 'Identifier') return callee.object.name;
  // result.map.set(...) → 'map'
  if (
    callee.object.type === 'MemberExpression' &&
    callee.object.property.type === 'Identifier'
  ) {
    return callee.object.property.name;
  }
  return null;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require Universal Name Handling normalization at entity-storage insertion sites in chart parsers',
    },
    schema: [],
    messages: {
      missingNormalize:
        "Entity-storage insertion `{{var}}.{{method}}(...)` must use a normalized key. " +
        "Pass `normalizeName(input)` (or use `getOrCreateName(input, store, line)`) from " +
        "`src/utils/name-normalize`. See docs/dgmo-language-spec.md § Universal Name Handling.",
    },
  },

  create(context) {
    const filename =
      typeof context.filename === 'string'
        ? context.filename
        : typeof context.getFilename === 'function'
          ? context.getFilename()
          : '';
    if (!filename || !PARSER_PATH_RE.test(filename)) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') return;
        if (callee.property.type !== 'Identifier') return;
        const method = callee.property.name;
        if (method !== 'set' && method !== 'add') return;

        const recv = receiverName(callee);
        if (!recv || !ENTITY_VAR_RE.test(recv)) return;

        const firstArg = node.arguments[0];
        if (looksNormalized(firstArg)) return;

        context.report({
          node,
          messageId: 'missingNormalize',
          data: { var: recv, method },
        });
      },
    };
  },
};
