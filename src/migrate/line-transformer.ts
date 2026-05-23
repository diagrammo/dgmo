// Single-line transformer for the `dgmo migrate` tool.
//
// Given a legacy line with a `|` metadata delimiter, emit the new
// §1.4 same-line form (`Foo k: v, k: v` — no pipe). Chart-type-specific
// bare-positional shapes (gantt `| 80%`, journey-map `| 4 Delighted`,
// pyramid/ring `| description text`) are promoted to keyed metadata
// per spec §13.8 / §22 / §23 / §24.
//
// Lines that the classifier flags as legacy but contain only invalid
// content (e.g. `|` with nothing after) are returned verbatim with
// `changed: false` — the legacy parser would have rejected them, the
// new parser will too, and the migration tool's contract is "don't
// repair pre-existing parse errors" (spec §"Migration Tool Contract").

import { findUnsafePipePositions } from './line-classifier';

/**
 * Rewrite every "unsafe" `|` (outside quotes / brace dropdowns /
 * arrow-label regions) inside `s` to a comma. Quoted, brace-nested,
 * and arrow-label pipes are left intact — this is the same scan the
 * classifier uses, applied as a substitution.
 */
function replaceUnsafePipesWithCommas(s: string): string {
  const positions = findUnsafePipePositions(s);
  if (positions.length === 0) return s;
  const chars = s.split('');
  for (const pos of positions) {
    chars[pos] = ',';
  }
  return chars.join('');
}

export interface TransformResult {
  /** New line content (indent preserved); equal to input when `changed: false`. */
  readonly line: string;
  /** Whether the transformer mutated the line. */
  readonly changed: boolean;
}

// ============================================================
// Chart-type-specific bare-positional promotions
// ============================================================

interface Promotion {
  /** Matches a single comma-tokenized bare meta segment. */
  readonly match: (token: string) => boolean;
  /** Returns a `key: value[, key: value]` string. */
  readonly promote: (token: string) => string;
}

// Gantt §13.8 — bare `<N>%` promotes to `progress: <N>`.
const GANTT_PERCENT: Promotion = {
  match: (t) => /^\d+(?:\.\d+)?\s*%$/.test(t.trim()),
  promote: (t) => `progress: ${t.trim().replace(/\s*%$/, '')}`,
};

// Journey-map §22 — bare `<N>` or `<N> <Word>` promotes to
// `score: <N>[, emotion: <Word>]`.
const JOURNEY_SCORE: Promotion = {
  match: (t) => /^\d+(?:\s+[A-Za-z][A-Za-z0-9_-]*)?$/.test(t.trim()),
  promote: (t) => {
    const m = t.trim().match(/^(\d+)(?:\s+([A-Za-z][A-Za-z0-9_-]*))?$/);
    if (!m) return t;
    return m[2] ? `score: ${m[1]}, emotion: ${m[2]}` : `score: ${m[1]}`;
  },
};

const PROMOTIONS_BY_CHART: Record<string, readonly Promotion[]> = {
  gantt: [GANTT_PERCENT],
  'journey-map': [JOURNEY_SCORE],
};

/**
 * Chart types whose meta region accepts a bare-text shorthand (`| Some
 * description text` with no `key:`) — promoted to `description: <text>`.
 * Only fires when the ENTIRE meta region contains no `:` at all.
 */
const BARE_DESCRIPTION_CHARTS = new Set(['pyramid', 'ring']);

// ============================================================
// Meta region tokenization
// ============================================================
//
// Split the meta region on commas, but respect quoted values so a
// `description: "with, commas"` segment stays whole.

function tokenizeMetaRegion(region: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  let buf = '';
  let inQuote: '"' | "'" | null = null;
  while (i < region.length) {
    const ch = region[i]!;
    if (inQuote) {
      buf += ch;
      if (ch === inQuote) inQuote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch as '"' | "'";
      buf += ch;
      i++;
      continue;
    }
    if (ch === ',') {
      const t = buf.trim();
      if (t) tokens.push(t);
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  const tail = buf.trim();
  if (tail) tokens.push(tail);
  return tokens;
}

// ============================================================
// Main transformer
// ============================================================

/**
 * Transform `line` from legacy `Foo | k: v, k: v` into the new §1.4
 * same-line form. `chartType` enables chart-type-specific bare-positional
 * promotions; pass `null` for the conservative generic transform.
 */
export function transformLine(
  line: string,
  chartType: string | null
): TransformResult {
  // Preserve the exact leading indent (mix of tabs/spaces).
  const indentMatch = line.match(/^[ \t]*/);
  const indent = indentMatch ? indentMatch[0] : '';
  const body = line.substring(indent.length);

  const pipePositions = findUnsafePipePositions(body);
  if (pipePositions.length === 0) {
    return { line, changed: false };
  }

  // First unsafe `|` is the cut point. Legacy grammar nominally
  // disallowed multiple metadata pipes on a line (E_MULTIPLE_PIPES),
  // but the pattern `Foo | k: v | k: v` is common in user content —
  // authors treated `|` as an inter-key delimiter. Convert any
  // additional unsafe pipes in the meta region into commas so the
  // tokenizer sees one flat comma-separated key list.
  const cut = pipePositions[0]!;
  const nameRegion = body.substring(0, cut).trimEnd();
  let metaRegion = body.substring(cut + 1).trimStart();
  if (pipePositions.length > 1) {
    metaRegion = replaceUnsafePipesWithCommas(metaRegion);
  }

  // Pyramid/ring "bare description" — entire meta region carries no
  // `:` AND no unsafe-pipe (i.e. no further metadata segments). The
  // whole text becomes `description: <text>`. Commas in the source
  // text are preserved by wrapping in quotes when needed.
  if (
    chartType !== null &&
    BARE_DESCRIPTION_CHARTS.has(chartType) &&
    !metaRegion.includes(':')
  ) {
    const text = metaRegion.trim();
    if (!text) {
      // `Foo |` with nothing after — let the new parser surface
      // the issue (empty-meta or pipe-removed); strip the pipe but
      // emit no metadata.
      return {
        line: indent + nameRegion,
        changed: true,
      };
    }
    const value = text.includes(',') ? `"${text}"` : text;
    return {
      line: `${indent}${nameRegion} description: ${value}`,
      changed: true,
    };
  }

  const tokens = tokenizeMetaRegion(metaRegion);
  const promotions = chartType ? (PROMOTIONS_BY_CHART[chartType] ?? []) : [];

  const emitted: string[] = [];
  for (const raw of tokens) {
    if (raw.includes(':')) {
      // Already a `key: value` pair — emit verbatim. Whitespace
      // around the `:` is preserved as authored; the new parser
      // tolerates either form (`k:v`, `k: v`).
      emitted.push(raw);
      continue;
    }
    // Bare token — try chart-type-specific promotions.
    const promo = promotions.find((p) => p.match(raw));
    if (promo) {
      emitted.push(promo.promote(raw));
      continue;
    }
    // Unrecognized bare token. Carry through verbatim — the new
    // parser will surface a diagnostic. Don't drop silently; the
    // user needs to see what's left over.
    emitted.push(raw);
  }

  if (emitted.length === 0) {
    return {
      line: indent + nameRegion,
      changed: true,
    };
  }

  return {
    line: `${indent}${nameRegion} ${emitted.join(', ')}`,
    changed: true,
  };
}
