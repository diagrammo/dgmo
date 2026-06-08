// ============================================================
// Generic diagram note — chart-neutral model
// ============================================================
//
// One annotation attachable to any node-based chart. The parser collects
// raw `{ref, body, color?}`; a shared resolver binds `ref` to a concrete
// node, and a shared placer + the `utils/note-box` drawer render it. Each
// chart adds only a note-line handler + an anchor (id/label) list.

export interface DiagramNote {
  /** Author-typed node id/label the note attaches to. */
  readonly ref: string;
  /** Body text (inline + indented lines, joined with `\n`). */
  readonly body: string;
  /** Resolved hex accent (border + faded fill); default yellow if absent. */
  readonly color?: string;
  readonly lineNumber: number;
  readonly endLineNumber: number;
}
