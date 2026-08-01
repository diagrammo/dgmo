// ============================================================
// Live link — Parser
// ============================================================
//
// Syntax (spec §38):
//   live-link <Title>                    // titled form — needs a `url` line
//   url <link-or-id>
//
//   live-link <id>                       // shorthand — the fence spelling
//
// A pointer, not a drawing: no elements, no indentation, no colons, and
// exactly one directive. The title slot is the only one in the language that
// can hold a TARGET instead of a name, and whitespace is what decides (§38.3).
//
// 🔴 The id shape and the URL forms are owned by `cloud-reference.ts` and are
// never re-declared or hand-parsed here. The single carve-out is the `?at=`
// pre-check below, and it is explained where it happens.

import { makeDgmoError, formatDgmoError } from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import { parseCloudReference } from '../cloud-reference';
import { parseFirstLine } from '../utils/parsing';
import type { ParsedLiveLink } from './types';

/** Directives every chart type accepts; inert here, but not a mistake. */
const GLOBAL_DIRECTIVES = new Set([
  'palette',
  'theme',
  'no-title',
  'legend-inline',
]);

/** The one example every "that isn't a diagram" message shows. */
const EXAMPLE_URL = 'https://online.diagrammo.app/d/dgm_7f2a91';

/**
 * Resolve one target string — a full Diagrammo link or a bare id — to a
 * diagram id, or `null` if it is neither.
 *
 * Both shapes delegate. The bare-id case reaches the shared parser through its
 * own FENCE spelling (`live-link <id>` IS the bare-id form, as typed in a docs
 * fence), which is how this file gets the id pattern without copying it.
 */
function resolveTarget(value: string): string | null {
  return (
    parseCloudReference(value)?.id ??
    parseCloudReference(`live-link ${value}`)?.id ??
    null
  );
}

/**
 * True when `value` is a URL asking for a pinned revision.
 *
 * 🔴 The one place this file touches a URL directly, and it is a PRE-CHECK
 * only — resolution still delegates. `parseCloudReferenceUrl` returns a bare
 * `null` for all four of its rejections (malformed, wrong protocol, unmatched
 * path, pinned revision), so delegation alone cannot tell "you pinned a
 * revision we cannot serve" from "that isn't a Diagrammo link". Widening the
 * shared parser's contract to return a reason would ripple through five
 * wrappers for one message.
 */
function isPinnedRevision(value: string): boolean {
  try {
    return new URL(value.trim()).searchParams.has('at');
  } catch {
    return false;
  }
}

export function parseLiveLink(content: string): ParsedLiveLink {
  const diagnostics: DgmoError[] = [];
  let error: string | null = null;

  /** First error wins the `error` slot; the rest still surface as diagnostics. */
  const fail = (line: number, message: string): void => {
    const diag = makeDgmoError(line, message);
    diagnostics.push(diag);
    error ??= formatDgmoError(diag);
  };
  const warn = (line: number, message: string): void => {
    diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  const lines = content.split('\n');

  // ── The declaration line ─────────────────────────────────
  let titleSlot: string | null = null;
  let titleLineNumber = 1;
  let bodyStart = lines.length;
  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const trimmed = lines[i]!.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#'))
      continue;
    const first = parseFirstLine(trimmed);
    titleLineNumber = i + 1;
    titleSlot = first?.title ?? null;
    bodyStart = i + 1;
    break;
  }

  // ── The body: `url`, the globals, and nothing else ───────
  const urls: { value: string; line: number }[] = [];
  for (let i = bodyStart; i < lines.length; i++) {
    // In-bounds by loop guard.
    const trimmed = lines[i]!.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#'))
      continue;

    const spaceIdx = trimmed.indexOf(' ');
    const key = (
      spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
    ).toLowerCase();
    const value = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

    if (key === 'url') {
      if (!value) {
        fail(
          i + 1,
          `"url" needs a diagram — a link like ${EXAMPLE_URL}, or a bare diagram id.`
        );
        continue;
      }
      urls.push({ value, line: i + 1 });
      continue;
    }
    if (GLOBAL_DIRECTIVES.has(key)) continue;

    warn(
      i + 1,
      `Unrecognized directive "${key}" — a live link takes only "url".`
    );
  }

  const titleIsPhrase = titleSlot !== null && /\s/.test(titleSlot);

  const done = (title: string | null, id: string | null): ParsedLiveLink => ({
    type: 'live-link',
    title,
    titleLineNumber,
    id,
    diagnostics,
    error,
  });

  // ── Nothing to point at ──────────────────────────────────
  if (urls.length === 0 && titleSlot === null) {
    fail(
      titleLineNumber,
      'A live link needs a diagram — add `url <link>`, or write `live-link <id>`.'
    );
    return done(null, null);
  }

  // ── Two targets. Never resolved by precedence: being wrong about which
  //    diagram a pointer points at is the only way this can fail badly. ──
  if (urls.length > 1) {
    // urls.length > 1 guarantees both.
    const [a, b] = [urls[0]!, urls[1]!];
    fail(
      b.line,
      `Two targets: "${a.value}" on line ${a.line} and "${b.value}" on line ${b.line}. A live link points at one diagram — delete one.`
    );
    return done(titleIsPhrase ? titleSlot : null, null);
  }

  const url = urls[0];

  if (url && titleSlot !== null && !titleIsPhrase) {
    fail(
      titleLineNumber,
      `Two targets: "${titleSlot}" on line ${titleLineNumber} and "${url.value}" on line ${url.line}. A live link points at one diagram — keep the \`url\` line and give line ${titleLineNumber} a title, or delete the \`url\` line.`
    );
    return done(null, null);
  }

  // ── The `url` form (titled, or headlined by its own id) ──
  if (url) {
    if (isPinnedRevision(url.value)) {
      fail(
        url.line,
        'A pinned revision cannot be served — a live link always shows the publisher\'s current version. Remove the "?at=" from the link.'
      );
      return done(titleSlot, null);
    }
    const id = resolveTarget(url.value);
    if (id === null) {
      fail(
        url.line,
        `"${url.value}" is not a Diagrammo diagram — use a link like ${EXAMPLE_URL}, or a bare diagram id.`
      );
      return done(titleSlot, null);
    }
    return done(titleSlot, id);
  }

  // ── No `url` line: the title slot is the target (§38.3) ──
  // A phrase cannot be an id, so a `url` line is what's missing. A single
  // token IS the id — and the parser must NOT guess that a one-word title was
  // meant as a title, because ids are a shape check, not a format check. If
  // that id turns out not to exist, the resolver is the layer that knows and
  // can say the useful thing.
  if (titleIsPhrase) {
    fail(
      titleLineNumber,
      `"${titleSlot}" is a title, not a diagram id — add a \`url <link>\` line naming the diagram this points at.`
    );
    return done(titleSlot, null);
  }

  // titleSlot is non-null and whitespace-free here.
  const id = resolveTarget(titleSlot!);
  if (id === null) {
    fail(
      titleLineNumber,
      `"${titleSlot!}" is not a diagram id — use a bare id, or add a \`url <link>\` line.`
    );
    return done(null, null);
  }
  return done(null, id);
}
