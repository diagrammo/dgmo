// ============================================================
// Generic diagram note — shared resolver
// ============================================================

import { makeDgmoError, suggest, type DgmoError } from '../../diagnostics';
import { normalizeName } from '../name-normalize';
import type { DiagramNote } from './model';

/** Minimal node shape a chart must expose for note resolution. */
export interface NoteTarget {
  readonly id: string;
  readonly label: string;
}

/**
 * Resolve each note's `ref` to a concrete node id (matched by normalized
 * label). Returns a map keyed by node id — one note per node, first wins.
 * When `diagnostics` is passed, emits an `error` for an unknown ref (with a
 * suggest), a `warning` when a ref is ambiguous across nodes, and a
 * `warning` when a node already has a note. Never silently drops.
 */
export function resolveNotes<T extends NoteTarget>(
  notes: readonly DiagramNote[],
  targets: readonly T[],
  diagnostics?: DgmoError[]
): Map<string, DiagramNote> {
  const byNodeId = new Map<string, DiagramNote>();
  if (notes.length === 0) return byNodeId;

  const byNormLabel = new Map<string, T[]>();
  for (const t of targets) {
    const key = normalizeName(t.label);
    const arr = byNormLabel.get(key);
    if (arr) arr.push(t);
    else byNormLabel.set(key, [t]);
  }

  for (const note of notes) {
    const matches = byNormLabel.get(normalizeName(note.ref));

    if (!matches || matches.length === 0) {
      if (diagnostics) {
        const hint = suggest(
          note.ref,
          targets.map((t) => t.label)
        );
        diagnostics.push(
          makeDgmoError(
            note.lineNumber,
            `Note references unknown node id "${note.ref}".${
              hint ? ' ' + hint : ''
            }`,
            'error'
          )
        );
      }
      continue;
    }

    const target = matches[0]!;
    if (matches.length > 1 && diagnostics) {
      diagnostics.push(
        makeDgmoError(
          note.lineNumber,
          `Note ref "${note.ref}" matches ${matches.length} nodes; attaching to the first.`,
          'warning'
        )
      );
    }

    if (byNodeId.has(target.id)) {
      if (diagnostics) {
        diagnostics.push(
          makeDgmoError(
            note.lineNumber,
            `Multiple notes on node "${target.label}"; keeping the first.`,
            'warning'
          )
        );
      }
      continue;
    }

    byNodeId.set(target.id, note);
  }

  return byNodeId;
}
