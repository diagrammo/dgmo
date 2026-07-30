/**
 * Cloud references — the shared resolver (Diagrammo Cloud story 10.6).
 *
 * A reference points at a diagram living in Diagrammo Cloud instead of at bytes
 * pasted into a document. The point of it is CURRENCY: a referenced diagram is
 * never stale, which is true for a team of one and needs no distribution to be
 * worth having.
 *
 * There are three SPELLINGS and exactly ONE parser, because each spelling is
 * native to where it gets typed:
 *
 *   | Surface                | Form                     |
 *   |------------------------|--------------------------|
 *   | docs frameworks        | `cloud abc123` in a fence|
 *   | Obsidian, desktop app  | `![[cloud:abc123]]`      |
 *   | anywhere taking a URL  | the plain URL            |
 *
 * 🔴 EVERY future modifier must land in all three (A9), and
 * `cloud-reference.test.ts` asserts parity across the forms from ONE table so a
 * modifier cannot ship into a single spelling. If you are adding a modifier and
 * only touching one branch below, the tests are about to tell you so.
 *
 * A reference ALWAYS FLOATS — it resolves to the current revision, which is the
 * whole point (a referenced diagram is never stale). A date pin (`@2026-03-12`)
 * was designed and then dropped on 2026-07-30: the server retains a bounded
 * number of versions and prunes on every push, so a pin would fail on exactly
 * the diagrams that are edited most. Anything carrying a modifier therefore
 * parses to NULL rather than silently floating — a document that asked to be
 * frozen must not quietly get the latest instead.
 *
 * This module is deliberately dependency-free and does no I/O: it is imported by
 * every wrapper and by the CLI, and a parser that reached the network would make
 * each of them harder to test than the thing they are testing.
 */

/** Default origin of the Cloud API. Overridable for self-host / staging / tests. */
export const CLOUD_API_BASE = 'https://api.diagrammo.app';

/** Where human-facing share links live — the URLs people actually copy. */
export const CLOUD_APP_BASE = 'https://online.diagrammo.app';

/** A parsed reference. An id, and — for now — deliberately nothing else. */
export interface CloudReference {
  id: string;
}

/**
 * Ids are prefixed ULIDs, but this is deliberately a SHAPE check and not a ULID
 * check: the server is the authority on whether an id exists, and a parser that
 * enforced the id format too would reject fixtures, self-hosted ids, and any
 * future prefix — failing at parse time with a worse error than the 404 it was
 * trying to prevent. Bounded so a malformed document can't hand a wrapper a
 * kilobyte of "id".
 */
const ID = String.raw`[A-Za-z0-9_-]{3,64}`;

/** `cloud abc123` — the whole body of a dgmo fence. */
const FENCE_RE = new RegExp(`^\\s*cloud\\s+(${ID})\\s*$`);

/** `![[cloud:abc123]]` — extends the local-file transclusion the app + Obsidian ship. */
const EMBED_RE = new RegExp(`^\\s*!\\[\\[\\s*cloud:\\s*(${ID})\\s*\\]\\]\\s*$`);

/**
 * A URL form. Three shapes are accepted, because the URL a person has in hand is
 * usually the one they were given rather than the API's:
 *   · the source endpoint    /public/diagrams/<id>/source
 *   · the shared-link page   /d/<id>
 *   · the legacy view page   /view/<id>
 */
const URL_PATH_RE = new RegExp(
  `^/(?:public/diagrams/(${ID})/source|d/(${ID})|view/(${ID}))/?$`
);

/**
 * Parse any of the three spellings. Returns null for anything that is not a
 * reference — callers use that to leave ordinary content alone, so this must not
 * throw and must not guess.
 */
export function parseCloudReference(text: string): CloudReference | null {
  const fence = FENCE_RE.exec(text) ?? EMBED_RE.exec(text);
  if (fence) return reference(fence[1]);
  return parseCloudReferenceUrl(text);
}

/** The URL spelling, split out because hosts that only take URLs need just this. */
export function parseCloudReferenceUrl(text: string): CloudReference | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const match = URL_PATH_RE.exec(url.pathname);
  if (!match) return null;
  // A URL carrying `?at=` is asking for a revision we cannot serve. Stripping it
  // and resolving anyway would hand a document that asked to be FROZEN the
  // latest revision instead — the one outcome pinning existed to prevent — so
  // this is not a reference we know how to resolve.
  if (url.searchParams.has('at')) return null;
  return reference(match[1] ?? match[2] ?? match[3]);
}

function reference(id: string | undefined): CloudReference | null {
  return id ? { id } : null;
}

export interface ResolveUrlOptions {
  /** Origin of the Cloud API. */
  base?: string;
}

/** The URL to fetch a reference's source from. Always the current revision. */
export function referenceSourceUrl(
  ref: CloudReference,
  options: ResolveUrlOptions = {}
): string {
  const base = (options.base ?? CLOUD_API_BASE).replace(/\/+$/, '');
  return `${base}/public/diagrams/${ref.id}/source`;
}

/** The human share link for a reference — what a "view this in Diagrammo" link points at. */
export function referenceShareUrl(
  ref: CloudReference,
  options: { base?: string } = {}
): string {
  const base = (options.base ?? CLOUD_APP_BASE).replace(/\/+$/, '');
  return `${base}/d/${ref.id}`;
}

/** The shape of a source response, so consumers don't re-declare it per wrapper. */
export interface CloudReferenceSource {
  id: string;
  source: string;
  dgmoVersion: string;
  updatedAt: number;
}
