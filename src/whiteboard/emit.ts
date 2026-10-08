// ============================================================
// Whiteboard diagram — emitter (model → canonical DGMO source)
// ============================================================
//
// The counterpart of `parseWhiteboard`, for the canvas that authors a board:
//
//     const src  = emitWhiteboard(board);
//     const back = parseWhiteboard(src);
//     assert(sameWhiteboard(board, back));      // round-trip
//     assert(back.diagnostics.length === 0);    // emitter cleanliness
//
// Canonical form: one element per line in z-order, metadata in a fixed key
// order, `color:` omitted when it is the default `ink`, ink payloads verbatim.
// Emitting the parse of canonical text reproduces it byte for byte.

import type { ParsedWhiteboard, WhiteboardElement } from './types';

/** Anything the parser would read as the start of metadata, or as quotes. */
const NEEDS_QUOTES_RE = /(^|\s)[a-z][a-z-]*:(\s|$)|^["']/;

/** A label or ref as the parser will read it back. */
function nameText(name: string): string {
  if (!NEEDS_QUOTES_RE.test(name)) return name;
  return name.includes('"') ? `'${name}'` : `"${name}"`;
}

function colorPart(color: string): string[] {
  return color === 'ink' ? [] : [`color: ${color}`];
}

function line(keyword: string, name: string, meta: string[]): string {
  const head = name ? `${keyword} ${nameText(name)}` : keyword;
  return `${head} ${meta.join(', ')}`;
}

/** One element's source line. */
export function emitWhiteboardElement(el: WhiteboardElement): string {
  switch (el.kind) {
    case 'shape':
      return line(el.shape, el.label, [
        `at: ${el.x} ${el.y}`,
        `size: ${el.width} ${el.height}`,
        ...colorPart(el.color),
      ]);
    case 'arrow':
      return line('arrow', el.label, [
        `from: ${el.x1} ${el.y1}`,
        `to: ${el.x2} ${el.y2}`,
        ...colorPart(el.color),
      ]);
    case 'text':
      return line('text', el.text, [
        `at: ${el.x} ${el.y}`,
        ...colorPart(el.color),
      ]);
    case 'image':
      return line('image', el.ref, [
        `at: ${el.x} ${el.y}`,
        `size: ${el.width} ${el.height}`,
      ]);
    case 'ink':
      return `ink ${el.color} ${String(el.width)} ${el.encoded}`;
  }
}

/** The whole board as canonical source, ending in a newline. */
export function emitWhiteboard(board: ParsedWhiteboard): string {
  const out: string[] = [
    board.title ? `whiteboard ${board.title}` : 'whiteboard',
  ];
  if (board.options.noTitle) out.push('no-title');
  for (const el of board.elements) out.push(emitWhiteboardElement(el));
  return out.join('\n') + '\n';
}

/** Structural equality ignoring line numbers and decoded points. */
export function sameWhiteboard(
  a: ParsedWhiteboard,
  b: ParsedWhiteboard
): boolean {
  const strip = (p: ParsedWhiteboard): unknown => ({
    title: p.title,
    options: p.options,
    elements: p.elements.map((el) => {
      const rest: Record<string, unknown> = { ...el };
      delete rest['lineNumber'];
      delete rest['points'];
      return rest;
    }),
  });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}
