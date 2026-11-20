// ============================================================
// Borrowed arrows (diagrammo/diagrammo#2174)
// ============================================================
//
// Mermaid's arrow spellings — `-->`, `-.->`, `==>`, `---`, `-- label -->` —
// are what most authors (and most AI models) reach for first. No dgmo chart
// type accepts them, but none refused them either: each parser read the extra
// characters as part of a name or a label, so the diagram came out WRONG with
// no diagnostic. On boxes-and-lines `A --> B` drew a box named "A -";
// `A -.-> B` drew an edge labelled "."; `A -dashed-> B` an edge labelled
// "dashed". The MCP `validate_diagram` called all three valid.
//
// dgmo has no dashed-edge style, by decision (owner, 2026-11-19): a label or a
// tag colour carries "weaker / planned / inferred". So this does not accept
// the spellings; it names them and writes the line the author meant.
//
// It runs once at the router, over the raw lines, so every edge-bearing chart
// type is covered without teaching each parser. It is a WARNING: the diagram
// still renders, just not as drawn.

import type { DgmoError, DiagnosticSpec } from '../diagnostics';
import { emit } from '../diagnostics';

/** Chart types whose edges are written with `->`. Class and ER keep their own
 *  relationship grammars, where `--` and `..` are legitimate. */
const EDGE_CHART_TYPES: ReadonlySet<string> = new Set([
  'boxes-and-lines',
  'flowchart',
  'state',
  'sitemap',
  'infra',
  'c4',
  'sequence',
  'swimlane',
  'map',
]);

/** Where a dashed line does exist, say how to get it. */
const DASHED_ALTERNATIVE: Readonly<Record<string, string>> = {
  infra: ' On infra, `~>` draws a dashed async edge.',
  c4: ' On c4, `~>` draws a dashed async relationship.',
  swimlane: ' On swimlane, `~>` between two pools draws a dashed message flow.',
};

/** Lines that hold free text, not edges. */
const TEXT_LINE =
  /^(?:title|subtitle|footnote|source|byline|caption|description|note)\b/i;

interface Shape {
  /** Finds the borrowed spelling; group 0 is what is quoted back. */
  find: RegExp;
  /** Rewrites the line to the dgmo spelling. */
  fix: (line: string) => string;
}

// Order matters: the labelled forms must be tried before their bare forms.
const SHAPES: Shape[] = [
  // Mermaid labelled dotted: `A -. text .-> B`
  {
    find: /-\.\s*[^.\s][^>]*?\s*\.-+>/,
    fix: (l) => l.replace(/-\.\s*([^.\s][^>]*?)\s*\.-+>/, '-$1->'),
  },
  // Mermaid dotted: `-.->`, `-..->`, `-.>`
  { find: /-\.+-?>/, fix: (l) => l.replace(/-\.+-?>/, '->') },
  // Mermaid labelled thick: `A == text ==> B`
  {
    find: /==\s*[^=\s][^>]*?\s*==+>/,
    fix: (l) => l.replace(/==\s*([^=\s][^>]*?)\s*==+>/, '-$1->'),
  },
  // Mermaid thick: `==>`
  { find: /==+>/, fix: (l) => l.replace(/==+>/, '->') },
  // Mermaid labelled: `A -- text --> B`, `A --text--> B`
  {
    find: /(?<![-~<])--\s*[^-\s>][^>]*?\s*--+>/,
    fix: (l) => l.replace(/(?<![-~<])--\s*([^-\s>][^>]*?)\s*--+>/, '-$1->'),
  },
  // Mermaid arrow: `-->`, `--->`
  { find: /(?<![~<])--+>/, fix: (l) => l.replace(/(?<![~<-])-{2,}>/, '->') },
  // UML dependency outside a class diagram: `..>`
  { find: /\.\.+>/, fix: (l) => l.replace(/\.\.+>/, '->') },
  // An edge "labelled" with its intended style: `-dashed->`, `-dotted->`
  {
    find: /-\s*(?:dashed|dotted)\s*->/i,
    fix: (l) => l.replace(/-\s*(?:dashed|dotted)\s*->/i, '->'),
  },
];

// Mermaid open link `A --- B` (not on map, where `--` is an undirected edge).
const OPEN_LINK: Shape = {
  find: /(?<=\S\s+)-{3,}(?=\s+\S)/,
  fix: (l) => l.replace(/\s+-{3,}\s+/, ' -> '),
};

export const BORROWED_ARROW_DX: DiagnosticSpec = {
  code: 'W_BORROWED_ARROW',
  severity: 'warning',
  chartType: null,
  title: 'Arrow spelling from another diagram language',
  message: (p) =>
    `\`${p.token ?? '-->'}\` is not a dgmo arrow, so this line does not draw what it looks like: dgmo reads the extra characters as part of a name or a label. Write \`${p.fixed ?? 'A -> B'}\`. dgmo has no dashed edges on ${p.chartType ?? 'boxes-and-lines'}.${p.alternative ?? ''}`,
  hint: 'Every dgmo edge is `->`, and a label goes between the dashes: `A -calls-> B`. To mark an edge as weaker, planned or inferred, say so in its label or give it a tag colour.',
  example: 'boxes-and-lines T\nA\nB\nA --> B',
};

function stripQuoted(line: string): string {
  return line.replace(/"[^"]*"/g, (m) => ' '.repeat(m.length));
}

/**
 * One warning per line that uses a borrowed arrow spelling, on the chart types
 * whose edges are written with `->`. `content` is the document as parsed.
 */
export function detectBorrowedArrows(
  content: string,
  chartType: string
): DgmoError[] {
  if (!EDGE_CHART_TYPES.has(chartType)) return [];
  const shapes = chartType === 'map' ? SHAPES : [...SHAPES, OPEN_LINK];
  const out: DgmoError[] = [];
  const lines = content.split('\n');
  let sawDeclaration = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#'))
      continue;
    // The declaration line is a title, which may say anything.
    if (!sawDeclaration) {
      sawDeclaration = true;
      continue;
    }
    if (TEXT_LINE.test(trimmed)) continue;
    const scan = stripQuoted(trimmed);
    for (const shape of shapes) {
      const m = scan.match(shape.find);
      if (!m) continue;
      out.push(
        emit(BORROWED_ARROW_DX, i + 1, {
          token: m[0].trim(),
          fixed: shape.fix(trimmed),
          chartType,
          alternative: DASHED_ALTERNATIVE[chartType] ?? '',
        })
      );
      break;
    }
  }
  return out;
}
