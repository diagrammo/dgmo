// Marks the root the parser builds from the `mindmap <title>` declaration.
//
// That line can carry no `collapsed` marker, so this root offers no collapse
// toggle (#1571). A root inferred from a real node line (a mindmap with no
// title) is never marked. `titleLineNumber` cannot tell the two apart: with no
// title, the parser sets it to the inferred root's own line.
//
// The mark is a module-private symbol, not a field on `MindmapNode`, so the
// published type surface does not change and JSON output does not carry it.
import type { MindmapNode } from './types';

const TITLE_ROOT = Symbol('mindmap.titleRoot');

type Marked = { [TITLE_ROOT]?: true };

export function markTitleRoot<T extends MindmapNode>(node: T): T {
  (node as T & Marked)[TITLE_ROOT] = true;
  return node;
}

export function isTitleRoot(node: MindmapNode): boolean {
  return (node as MindmapNode & Marked)[TITLE_ROOT] === true;
}
