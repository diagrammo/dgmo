// ============================================================
// fence-validate.mjs — the single shared extract + parse path
//
// Imported by BOTH the CI fence-parse test
// (tests/language-reference-examples.test.ts) and the core generator
// (scripts/gen-ai-core.mjs), so the generation-time gate and the CI gate
// can never disagree (ADR-8 / AC16).
//
// Verifies DGMO snippets against the PARSER (parseDgmo), not against
// fixtures or CLAUDE.md notes. parseDgmo is reached via the
// `@diagrammo/dgmo/advanced` subpath — the package root exports it aliased
// as `validate`, and `/internal` is a deprecated alias for `/advanced`
// (see src/internal.ts). Spec F3 named `/internal`; source says use
// `/advanced`, and the spec's own rule is "verify against source."
// ============================================================

import { parseDgmo } from '@diagrammo/dgmo/advanced';

/**
 * Extract fenced DGMO code blocks from a Markdown string.
 *
 * Recognizes two info-string forms:
 *   ```dgmo          → a normal example, validated by the 0-error gate
 *   ```dgmo-bad      → a deliberate counter-example, collected but flagged
 *                      `counterExample: true` so callers can exclude it from
 *                      the 0-error gate (F17 — the spec doc carries WRONG
 *                      examples on purpose).
 *
 * A `dgmo` fence may also carry an `ignore` flag in its meta
 * (```dgmo ignore) to opt a single fence out of the gate.
 *
 * @param {string} markdown
 * @param {string} [sourcePath] — for diagnostics/labelling only
 * @returns {Array<{ source: string, line: number, sourcePath: string|undefined, counterExample: boolean }>}
 */
export function extractDgmoFences(markdown, sourcePath) {
  const fences = [];
  const lines = markdown.split('\n');
  let inFence = false;
  let fenceInfo = '';
  let fenceMarker = '';
  let buffer = [];
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const openMatch = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);

    if (!inFence) {
      if (openMatch) {
        const info = openMatch[3].trim();
        const firstWord = info.split(/\s+/)[0] || '';
        if (firstWord === 'dgmo' || firstWord === 'dgmo-bad') {
          inFence = true;
          fenceInfo = info;
          fenceMarker = openMatch[2][0]; // ` or ~
          buffer = [];
          startLine = i + 2; // 1-based line of first content line
        }
      }
      continue;
    }

    // inside a dgmo fence — close on a matching fence marker
    const closeMatch = line.match(/^(\s*)(`{3,}|~{3,})\s*$/);
    if (closeMatch && closeMatch[2][0] === fenceMarker) {
      const firstWord = fenceInfo.split(/\s+/)[0];
      const ignore = /\bignore\b/.test(fenceInfo);
      if (!ignore) {
        fences.push({
          source: buffer.join('\n'),
          line: startLine,
          sourcePath,
          counterExample: firstWord === 'dgmo-bad',
        });
      }
      inFence = false;
      fenceInfo = '';
      buffer = [];
      continue;
    }
    buffer.push(line);
  }

  return fences;
}

/**
 * Parse a single DGMO snippet and split diagnostics by severity.
 *
 * @param {string} source
 * @returns {{ errors: object[], warnings: object[], chartType: string|null }}
 */
export function validateDgmoSource(source) {
  const { diagnostics, chartType } = parseDgmo(source);
  return {
    errors: diagnostics.filter((d) => d.severity === 'error'),
    warnings: diagnostics.filter((d) => d.severity === 'warning'),
    chartType,
  };
}

/**
 * Format a diagnostic for a readable test failure message.
 * @param {object} d
 */
export function formatDiagnostic(d) {
  const loc = d.line ? `line ${d.line}${d.column ? `:${d.column}` : ''}` : 'no line';
  const code = d.code ? ` [${d.code}]` : '';
  return `${loc}${code}: ${d.message}`;
}
