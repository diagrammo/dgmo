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
import {
  parseCloudReference,
  parseCloudReferenceUrl,
} from '../cloud-reference';
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
  const trimmed = value.trim();
  // The URL shape, through the split-out entry point rather than through
  // `parseCloudReference` — the latter also tries the FENCE and EMBED spellings,
  // and `url live-link abc` / `url ![[live-link:abc]]` are copy-paste mistakes.
  // Blessing them silently teaches the wrong shape.
  const asUrl = parseCloudReferenceUrl(trimmed)?.id;
  if (asUrl) return asUrl;
  // The bare-id path, reached through the fence spelling (`live-link <id>` IS
  // the bare-id form) so the id pattern is never copied here. Guarded to a
  // single token so the synthesis cannot smuggle the other spellings back in.
  if (!/^[^\s[\]]+$/.test(trimmed)) return null;
  return parseCloudReference(`live-link ${trimmed}`)?.id ?? null;
}

/**
 * The pin `value` carries, if stripping it would make the value resolve.
 *
 * 🔴 The one place this file constructs a URL itself, and it stays a PRE-CHECK:
 * resolution still delegates. `parseCloudReferenceUrl` returns a bare `null`
 * for all four of its rejections (malformed, wrong protocol, unmatched path,
 * pinned revision), so delegation alone cannot tell "you pinned a revision we
 * cannot serve" from "that isn't a Diagrammo link". Widening the shared
 * parser's contract to return a reason would ripple through five wrappers for
 * one message.
 *
 * Strip-and-retry rather than "does it have ?at=", so this only fires on
 * something that WOULD have resolved. `https://example.com/blog?at=1` is not a
 * pinned diagram, and telling its author to remove the `?at=` sends them after
 * the wrong problem. It covers the `@` spelling too — `dgm_1@2026-03-12` — which
 * is the form most likely to actually carry a pin.
 */
function pinnedRevision(value: string): string | null {
  const trimmed = value.trim();
  if (resolveTarget(trimmed) !== null) return null;

  try {
    const url = new URL(trimmed);
    const at = url.searchParams.get('at');
    if (at !== null) {
      url.searchParams.delete('at');
      if (resolveTarget(url.toString()) !== null) return `?at=${at}`;
    }
  } catch {
    // Not a URL — fall through to the `@` spelling below.
  }

  const at = trimmed.indexOf('@');
  if (at > 0) {
    const pin = trimmed.slice(at);
    if (resolveTarget(trimmed.slice(0, at)) !== null) return pin;
  }
  return null;
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

  // §1.2: `//` is the comment marker and `#` is NOT one outside PERT — a
  // `#`-led line here is content, and content that isn't `url` gets warned about
  // rather than silently dropped.
  const isSkippable = (line: string): boolean => !line || line.startsWith('//');

  // ── The declaration line ─────────────────────────────────
  let titleSlot: string | null = null;
  let titleLineNumber = 1;
  let bodyStart = lines.length;
  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const trimmed = lines[i]!.trim();
    if (isSkippable(trimmed)) continue;
    const first = parseFirstLine(trimmed);
    titleLineNumber = i + 1;
    titleSlot = first?.title ?? null;
    // Only CONSUME the line when it really was the declaration. Reached through
    // the router it always is, but `parseLiveLink` is exported, and swallowing
    // a `url` line here would report "add a `url` line" one line after reading
    // one.
    bodyStart = first ? i + 1 : i;
    break;
  }

  // ── The body: `url`, the globals, and nothing else ───────
  /** A `url` line that named nothing usable still COUNTS as one. */
  let sawUrlLine = false;
  const urls: { value: string; line: number }[] = [];
  for (let i = bodyStart; i < lines.length; i++) {
    // In-bounds by loop guard.
    const trimmed = lines[i]!.trim();
    if (isSkippable(trimmed)) continue;

    // Split on any whitespace: a tab between key and value is invisible in an
    // editor, and treating the whole line as one long directive name produces a
    // baffling message about a directive nobody typed.
    const spaceIdx = trimmed.search(/\s/);
    const key = (
      spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
    ).toLowerCase();
    const value = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

    if (key === 'url') {
      sawUrlLine = true;
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
  // `sawUrlLine`, not `urls.length`: a `url` line whose value was unusable has
  // already been reported ON THAT LINE, and following it with "add a `url`
  // line" on line 1 tells the author to write what they just wrote.
  if (!sawUrlLine && titleSlot === null) {
    fail(
      titleLineNumber,
      'A live link needs a diagram — add `url <link>`, or write `live-link <id>`.'
    );
    return done(null, null);
  }
  // A `url` line that named nothing usable: the error is already on that line,
  // and the title slot must NOT now be reinterpreted as the target.
  if (sawUrlLine && urls.length === 0) {
    return done(titleIsPhrase ? titleSlot : null, null);
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
    const pin = pinnedRevision(url.value);
    if (pin !== null) {
      fail(
        url.line,
        `A pinned revision cannot be served — a live link always shows the publisher's current version. Remove the "${pin}" from the link.`
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
  const shorthandPin = pinnedRevision(titleSlot!);
  if (shorthandPin !== null) {
    fail(
      titleLineNumber,
      `A pinned revision cannot be served — a live link always shows the publisher's current version. Remove the "${shorthandPin}" from the id.`
    );
    return done(null, null);
  }
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
