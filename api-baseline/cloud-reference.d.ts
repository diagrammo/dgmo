/**
 * Live links — the shared resolver (Diagrammo Cloud story 10.6).
 *
 * A live link points at a diagram living in Diagrammo Cloud instead of at bytes
 * pasted into a document. The point of it is CURRENCY: a linked diagram is
 * never stale, which is true for a team of one and needs no distribution to be
 * worth having.
 *
 * There are three SPELLINGS and exactly ONE parser, because each spelling is
 * native to where it gets typed:
 *
 *   | Surface                | Form                        |
 *   |------------------------|-----------------------------|
 *   | docs frameworks        | `live-link abc123` in a fence|
 *   | Obsidian, desktop app  | `![[live-link:abc123]]`     |
 *   | anywhere taking a URL  | the plain URL               |
 *
 * The keyword was `cloud` until 2026-08-01 (decision #53). `cloud` named where
 * the thing lives; `live-link` names what it is, and it is the publish dialog's
 * own phrase, so one word now spans both sides of the exchange. Pre-1.0 there
 * is no dual-accept window — `cloud abc123` simply stops resolving. The module
 * and its package subpath keep the old name deliberately: renaming a subpath
 * export breaks the app's `pnpm dev` while the production build stays green.
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
declare const CLOUD_API_BASE = "https://api.diagrammo.app";
/** Where human-facing share links live — the URLs people actually copy. */
declare const CLOUD_APP_BASE = "https://online.diagrammo.app";
/** A parsed reference. An id, and — for now — deliberately nothing else. */
interface CloudReference {
    id: string;
}
/**
 * Parse any of the three spellings, wherever it appears.
 *
 * 🔴 **A `dgmo` fence must NOT use this — use `parseCloudReferenceFence`.** The
 * embed spelling is host markdown, and inside a fence the content is DGMO, so
 * accepting `![[live-link:<id>]]` there is a category error: markdown nested in
 * a code fence that is itself in markdown. It was accepted until 2026-08-05 and
 * the showcase content taught it. Removed rather than deprecated — pre-1.0.
 *
 * This union survives for a host scanning raw note text, where any of the three
 * may legitimately turn up. Returns null for anything that is not a reference,
 * so it must not throw and must not guess.
 */
declare function parseCloudReference(text: string): CloudReference | null;
/**
 * What may appear as the whole body of a `dgmo` fence: the keyword form, or a
 * plain link somebody pasted. **Not** the embed spelling — see above.
 */
declare function parseCloudReferenceFence(text: string): CloudReference | null;
/**
 * The note spelling — `![[live-link:<id>]]` — which extends the
 * `![[foo.dgmo]]` transclusion Obsidian and the desktop app already understand.
 * Takes the text as TYPED, brackets included, because that is the thing being
 * recognised; a host holding only the inside of the brackets puts them back.
 */
declare function parseCloudReferenceEmbed(text: string): CloudReference | null;
/** The URL spelling, split out because hosts that only take URLs need just this. */
declare function parseCloudReferenceUrl(text: string): CloudReference | null;
interface ResolveUrlOptions {
    /** Origin of the Cloud API. */
    base?: string;
}
/** The URL to fetch a reference's source from. Always the current revision. */
declare function referenceSourceUrl(ref: CloudReference, options?: ResolveUrlOptions): string;
/** The human share link for a reference — what a "view this in Diagrammo" link points at. */
declare function referenceShareUrl(ref: CloudReference, options?: {
    base?: string;
}): string;
/** The shape of a source response, so consumers don't re-declare it per wrapper. */
interface CloudReferenceSource {
    id: string;
    source: string;
    dgmoVersion: string;
    updatedAt: number;
}

export { CLOUD_API_BASE, CLOUD_APP_BASE, type CloudReference, type CloudReferenceSource, type ResolveUrlOptions, parseCloudReference, parseCloudReferenceEmbed, parseCloudReferenceFence, parseCloudReferenceUrl, referenceShareUrl, referenceSourceUrl };
