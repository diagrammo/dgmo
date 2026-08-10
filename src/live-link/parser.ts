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
//   https://online.diagrammo.app/d/<id>  // §38.6, the whole line IS the pointer
//
// 🔴 The note spelling `![[live-link:<id>]]` is NOT valid in a fence, and was
// removed from one on 2026-08-05. It is host markdown, and a fence's content is
// DGMO — nesting markdown inside a code fence that is itself in markdown is a
// category error however well it parses. It stays valid in a note BODY, which
// is the surface it was designed for.
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
  parseCloudReferenceFence,
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
 *
 * Exported for hosts that take a target OUTSIDE a fence — `<dgmo-diagram
 * watch="…">` takes exactly the same two spellings from an HTML attribute. They
 * resolve here and word their own messages, because "add a `url <link>` line"
 * names a line that does not exist in an HTML attribute.
 */
export function resolveLiveLinkTarget(value: string): string | null {
  const trimmed = value.trim();
  // The URL shape, through the split-out entry point rather than a broader one:
  // `url live-link abc` and `url ![[live-link:abc]]` are copy-paste mistakes,
  // and blessing them silently teaches the wrong shape.
  const asUrl = parseCloudReferenceUrl(trimmed)?.id;
  if (asUrl) return asUrl;
  // The bare-id path, reached through the fence spelling (`live-link <id>` IS
  // the bare-id form) so the id pattern is never copied here. Guarded to a
  // single token so the synthesis cannot smuggle the other spellings back in.
  if (!/^[^\s[\]]+$/.test(trimmed)) return null;
  return parseCloudReferenceFence(`live-link ${trimmed}`)?.id ?? null;
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
export function liveLinkPinnedRevision(value: string): string | null {
  const trimmed = value.trim();
  if (resolveLiveLinkTarget(trimmed) !== null) return null;

  try {
    const url = new URL(trimmed);
    const at = url.searchParams.get('at');
    if (at !== null) {
      url.searchParams.delete('at');
      if (resolveLiveLinkTarget(url.toString()) !== null) return `?at=${at}`;
    }
  } catch {
    // Not a URL — fall through to the `@` spelling below.
  }

  const at = trimmed.indexOf('@');
  if (at > 0) {
    const pin = trimmed.slice(at);
    if (resolveLiveLinkTarget(trimmed.slice(0, at)) !== null) return pin;
  }
  return null;
}

/**
 * Is this line, on its own, a live-link pointer (§38.6)?
 *
 * True for the ones this parser REFUSES as well as the ones it resolves —
 * a pinned share link most of all. The router needs the refusals, because a
 * line it declines to claim falls through to the visualization parser and comes
 * back as "Unsupported chart type", which is the message §38.6 exists to stop.
 * Refusing well is this parser's job; the router only decides whose job it is.
 */
export function isLiveLinkLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    parseCloudReferenceFence(trimmed) !== null ||
    liveLinkPinnedRevision(trimmed) !== null
  );
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
  /**
   * The id, when the declaration line IS the pointer rather than a keyword plus
   * a slot — §38.6's pasted-share-link form.
   *
   * 🔴 `parseCloudReferenceFence`, never the union: a fence takes the keyword
   * form or a plain link, and NOT the note's `![[live-link:<id>]]`. Reaching for
   * `parseCloudReference` here is what let markdown into a code fence.
   */
  let wholeLineId: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const trimmed = lines[i]!.trim();
    if (isSkippable(trimmed)) continue;
    const first = parseFirstLine(trimmed);
    titleLineNumber = i + 1;
    if (!first) {
      wholeLineId = parseCloudReferenceFence(trimmed)?.id ?? null;
      if (wholeLineId !== null) {
        bodyStart = i + 1;
        break;
      }
      // The router sent a pinned link here on purpose, so that the pin gets its
      // own message instead of the generic one it used to collect.
      const pin = liveLinkPinnedRevision(trimmed);
      if (pin !== null) {
        fail(
          i + 1,
          `A pinned revision cannot be served — a live link always shows the publisher's current version. Remove the "${pin}" from the link.`
        );
        return {
          type: 'live-link',
          title: null,
          titleLineNumber: i + 1,
          id: null,
          diagnostics,
          error,
        };
      }
    }
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

  // ── A whole-line pointer (§38.6) ─────────────────────────
  // The line carried the target itself, so there is no title slot to read and
  // no shorthand-versus-titled question to answer. A `url` line written anyway
  // is still two targets, and refuses for the same reason the titled form does:
  // being wrong about which diagram a pointer points at is the only way this
  // construct fails badly.
  if (wholeLineId !== null) {
    const rival = urls[0];
    if (rival) {
      fail(
        rival.line,
        `Two targets: the link on line ${titleLineNumber} and "${rival.value}" on line ${rival.line}. A live link points at one diagram — delete one.`
      );
      return done(null, null);
    }
    return done(null, wholeLineId);
  }

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
    const pin = liveLinkPinnedRevision(url.value);
    if (pin !== null) {
      fail(
        url.line,
        `A pinned revision cannot be served — a live link always shows the publisher's current version. Remove the "${pin}" from the link.`
      );
      return done(titleSlot, null);
    }
    const id = resolveLiveLinkTarget(url.value);
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
  const shorthandPin = liveLinkPinnedRevision(titleSlot!);
  if (shorthandPin !== null) {
    fail(
      titleLineNumber,
      `A pinned revision cannot be served — a live link always shows the publisher's current version. Remove the "${shorthandPin}" from the id.`
    );
    return done(null, null);
  }
  const id = resolveLiveLinkTarget(titleSlot!);
  if (id === null) {
    fail(
      titleLineNumber,
      `"${titleSlot!}" is not a diagram id — use a bare id, or add a \`url <link>\` line.`
    );
    return done(null, null);
  }
  return done(null, id);
}
