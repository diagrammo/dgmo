// ============================================================
// ref-anchors.mjs — parse the machine-extractable anchors in
// language-reference.md. The anchor scheme IS the single source of truth for
// per-type slicing (Task 1); both the core generator (gen-ai-core.mjs) and the
// MCP `extractSection` rework (Task 6) read these same anchors so retrieval and
// generation can never disagree about where a type's block lives.
//
// Anchors:
//   <!-- TYPE:<id> -->                 marks the start of a chart-type's block
//   <!-- TYPE-ALIASES: a=b c=b ... -->  ids that share another id's block
//   <!-- AI-CORE:<NAME> start --> … <!-- AI-CORE:<NAME> end -->
//
// A TYPE block runs from its marker to the NEXT `<!-- TYPE:` marker or the next
// `^## ` (H2) heading, whichever comes first.
// ============================================================

/** Parse the TYPE-ALIASES comment into a Map<aliasId, targetId>. */
export function parseTypeAliases(markdown) {
  const m = markdown.match(/<!--\s*TYPE-ALIASES:\s*([^>]*?)-->/);
  const map = new Map();
  if (!m) return map;
  for (const pair of m[1].trim().split(/\s+/)) {
    const [alias, target] = pair.split('=');
    if (alias && target) map.set(alias.trim(), target.trim());
  }
  return map;
}

/** All chart-type ids that have a literal `<!-- TYPE:id -->` marker. */
export function listTypeAnchors(markdown) {
  const ids = [];
  const re = /<!--\s*TYPE:([a-z0-9-]+)\s*-->/g;
  let m;
  while ((m = re.exec(markdown))) ids.push(m[1]);
  return ids;
}

/**
 * Slice the per-type block for `id`, resolving aliases first.
 * Returns the markdown block (heading-anchored content), or null if no anchor.
 */
export function extractTypeBlock(markdown, id) {
  const aliases = parseTypeAliases(markdown);
  const resolved = aliases.get(id) ?? id;
  const startRe = new RegExp(`<!--\\s*TYPE:${resolved}\\s*-->`);
  const startMatch = startRe.exec(markdown);
  if (!startMatch) return null;
  const start = startMatch.index;
  const rest = markdown.slice(start + startMatch[0].length);
  // End at the next TYPE marker or the next H2 heading.
  const nextType = rest.search(/<!--\s*TYPE:[a-z0-9-]+\s*-->/);
  const nextH2 = rest.search(/^## /m);
  const candidates = [nextType, nextH2].filter((n) => n !== -1);
  const rel = candidates.length ? Math.min(...candidates) : rest.length;
  const end = start + startMatch[0].length + rel;
  return markdown.slice(start, end).trim();
}

/** Content between AI-CORE:<name> start/end markers (exclusive of the markers). */
export function extractAiCore(markdown, name) {
  const re = new RegExp(
    `<!--\\s*AI-CORE:${name}\\s+start\\s*-->([\\s\\S]*?)<!--\\s*AI-CORE:${name}\\s+end\\s*-->`,
  );
  const m = re.exec(markdown);
  return m ? m[1].trim() : null;
}
