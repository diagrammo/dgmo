// ============================================================
// Whiteboard diagram — Diagnostic codes (spec §39.8)
// ============================================================
//
// Every one is a WARNING: a malformed line is skipped and the rest of the
// board renders. Only a wrong first line or an empty board is fatal, and those
// use the code-less parse-error path every chart type shares.

import type { DiagnosticMessageParams, DiagnosticSpec } from '../diagnostics';

export const WHITEBOARD_DIAGNOSTIC_CODES = {
  UNKNOWN_ELEMENT: 'W_WHITEBOARD_UNKNOWN_ELEMENT',
  BAD_GEOMETRY: 'W_WHITEBOARD_BAD_GEOMETRY',
  OUT_OF_RANGE: 'W_WHITEBOARD_OUT_OF_RANGE',
  UNKNOWN_COLOR: 'W_WHITEBOARD_UNKNOWN_COLOR',
  UNKNOWN_KEY: 'W_WHITEBOARD_UNKNOWN_KEY',
  BAD_INK: 'W_WHITEBOARD_BAD_INK',
  BAD_IMAGE_REF: 'W_WHITEBOARD_BAD_IMAGE_REF',
  EMPTY_TEXT: 'W_WHITEBOARD_EMPTY_TEXT',
} as const;

const s = (v: unknown): string => String(v ?? '?');

export const WHITEBOARD_DIAGNOSTICS: DiagnosticSpec[] = [
  {
    code: WHITEBOARD_DIAGNOSTIC_CODES.UNKNOWN_ELEMENT,
    severity: 'warning',
    chartType: 'whiteboard',
    title: 'Unknown whiteboard element',
    message: (p) =>
      `Unknown element "${s(p.word)}" — a whiteboard line starts with rectangle, ellipse, database, queue, arrow, text, image or ink; line skipped${p.hint ? `. ${s(p.hint)}` : ''}`,
    hint: 'Start the line with one of the eight element keywords.',
    example: 'whiteboard\nsquare Start at: 0 0, size: 120 60',
  },
  {
    code: WHITEBOARD_DIAGNOSTIC_CODES.BAD_GEOMETRY,
    severity: 'warning',
    chartType: 'whiteboard',
    title: 'Missing or malformed position',
    message: (p) =>
      `${s(p.element)} needs ${s(p.need)} — got ${s(p.got)}; line skipped`,
    hint: 'Positions and sizes are two whole numbers separated by a space: at: 40 -20, size: 160 80.',
    example: 'whiteboard\nellipse Idea at: 40, size: 160 80',
  },
  {
    code: WHITEBOARD_DIAGNOSTIC_CODES.OUT_OF_RANGE,
    severity: 'warning',
    chartType: 'whiteboard',
    title: 'Coordinate out of range',
    message: (p) =>
      `${s(p.key)}: "${s(p.raw)}" is out of range — coordinates stay within ±${s(p.max)} px and sizes are at least 1; line skipped`,
    hint: 'Keep the board near the origin; a runaway drag value is the usual cause.',
    example: 'whiteboard\nrectangle at: 0 0, size: 0 50',
  },
  {
    code: WHITEBOARD_DIAGNOSTIC_CODES.UNKNOWN_COLOR,
    severity: 'warning',
    chartType: 'whiteboard',
    title: 'Unknown colour',
    message: (p) =>
      `Unknown colour "${s(p.color)}" — drawn in ink (valid: ink, red, green, blue, teal, purple, orange, yellow, cyan, gray)${p.hint ? `. ${s(p.hint)}` : ''}`,
    hint: 'Colours are palette names, never hex values.',
    example: 'whiteboard\ntext Ship it at: 0 0, color: crimson',
  },
  {
    code: WHITEBOARD_DIAGNOSTIC_CODES.UNKNOWN_KEY,
    severity: 'warning',
    chartType: 'whiteboard',
    title: 'Unknown metadata key',
    message: (p) =>
      `Unknown key "${s(p.key)}" on ${s(p.element)} — ignored (valid here: ${s(p.valid)})${p.hint ? `. ${s(p.hint)}` : ''}`,
    hint: 'Quote a label that itself contains "word:" so it is not read as a key.',
    example: 'whiteboard\ntext Ship at: 0 0, colour: red',
  },
  {
    code: WHITEBOARD_DIAGNOSTIC_CODES.BAD_INK,
    severity: 'warning',
    chartType: 'whiteboard',
    title: 'Unreadable ink stroke',
    message: (p) => `Ink stroke skipped — ${s(p.reason)}`,
    hint: 'An ink line is `ink <colour> <width> <encoded path>`, written by the whiteboard canvas. Do not hand-write or edit the path.',
    example: 'whiteboard\nink red 3 !!!',
  },
  {
    code: WHITEBOARD_DIAGNOSTIC_CODES.BAD_IMAGE_REF,
    severity: 'warning',
    chartType: 'whiteboard',
    title: 'Unusable image reference',
    message: (p) =>
      `Image "${s(p.ref)}" skipped — an image is a relative path (name.assets/file.webp) or an https:// URL`,
    hint: 'Use a path relative to the diagram, or an https:// link.',
    example: 'whiteboard\nimage ftp://example.com/a.png at: 0 0, size: 320 200',
  },
  {
    code: WHITEBOARD_DIAGNOSTIC_CODES.EMPTY_TEXT,
    severity: 'warning',
    chartType: 'whiteboard',
    title: 'Empty text',
    message: () => 'A text line needs some text — line skipped',
    hint: 'Write the words between `text` and `at:`.',
    example: 'whiteboard\ntext at: 0 0',
  },
];

const BY_CODE = new Map(WHITEBOARD_DIAGNOSTICS.map((d) => [d.code, d]));

/** The registered message for `code` — the parser's single source of wording. */
export function whiteboardMessage(
  code: (typeof WHITEBOARD_DIAGNOSTIC_CODES)[keyof typeof WHITEBOARD_DIAGNOSTIC_CODES],
  params: DiagnosticMessageParams
): string {
  const msg = BY_CODE.get(code)!.message;
  return typeof msg === 'string' ? msg : msg(params);
}
