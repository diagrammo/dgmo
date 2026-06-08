// ============================================================
// Graph notes — thin re-export over the shared note pipeline
// ============================================================
//
// The note model, grammar, and resolver are now chart-neutral and live in
// `utils/notes/`. This module stays as the graph family's import site so
// the flowchart/state parsers (and their tests) keep one stable path. New
// charts should import from `utils/notes` directly.

export {
  parseNoteHeader,
  collectNoteBody,
  tryCollectNote,
  resolveNotes,
} from '../utils/notes';
export type {
  DiagramNote,
  CollectedNoteBody,
  TryCollectNoteResult,
  NoteTarget,
} from '../utils/notes';
