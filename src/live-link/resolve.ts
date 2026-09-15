// ============================================================
// Live link — asking the Cloud what a pointer points at
// ============================================================
//
// One step, and deliberately only one: **fetch the published source and decide
// what the answer MEANS**. What a host should DO about that answer is not here
// and must not move here — the two are different questions, and conflating them
// is what made this code unreachable from anywhere but a markdown build.
//
//   what a response means   → this file, shared by every surface
//   what to do about it     → the host: stop a build, warn, draw a card,
//                             keep the copy it already had
//
// A docs build can fail; a note being opened cannot. A committed cache is a
// reviewable diff; a vault cache is not. Offline is an edge case on a build
// server and the normal case on a phone. Those are all host decisions, and each
// one is a reason this file stays free of them.
//
// 🔴 It lives beside the parser and the card renderer because a live link is a
// chart type here, not a markdown feature. It is nonetheless its OWN subpath
// (`@diagrammo/dgmo/live-link-resolve`) importing nothing but `cloud-reference`,
// so that resolving costs a caller no renderer and rendering costs a caller no
// network. Do not merge it into `./cloud-reference`, which promises zero I/O to
// five wrappers that only ever want to parse.
//
// History worth keeping: this began inside `remark-dgmo`, where four of the
// five docs wrappers could reach it and nothing else could. `vitepress-dgmo`
// shipped a release announcing live links it could not render, and the Obsidian
// plugin hit the same wall from the other side. Moved 2026-08-04.

import type { CloudReference, CloudReferenceSource } from '../cloud-reference';
import { referenceSourceUrl } from '../cloud-reference';

/** Default per-request timeout. A build waits; a reader should not. */
export const DEFAULT_LIVE_LINK_TIMEOUT_MS = 10_000;

/**
 * What the source endpoint said, once it has been read.
 *
 * Four outcomes, and the split is the whole point — a host that cannot tell
 * `gone` from `unavailable` will either keep publishing something its author
 * withdrew, or throw away a good copy because one request was dropped.
 */
export type LiveLinkFetch =
  /** 200, and the body was the shape we expect. */
  | { kind: 'ok'; entry: CloudReferenceSource }
  /** 410 — the author withdrew it. Deliberate, and not a failure. */
  | { kind: 'gone' }
  /** 404 — no such published diagram. A typo, or never published. */
  | { kind: 'missing' }
  /** Network, timeout, 5xx, 429, or a body we could not read. Try again later. */
  | { kind: 'unavailable'; reason: string };

export interface LiveLinkFetchOptions {
  /** Cloud API origin. Default: the public one. */
  base?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /**
   * The HTTP call. Defaults to `globalThis.fetch` **bound to the global**.
   *
   * 🔴 The binding is not tidiness. `fetch` is a WebIDL operation whose `this`
   * must be the global object, so holding it on an options bag and calling
   * `opts.fetchImpl(url)` passes the bag as `this` and throws
   * `Illegal invocation`. That exact bug shipped in every release of the browser
   * refresh path and was invisible for the feature's whole lifetime, because the
   * throw landed in a catch that reads any failure as "offline or CSP-blocked".
   * Node's fetch happens to tolerate a wrong `this`, which is precisely why the
   * browser half was never caught by a build.
   *
   * A host with its own client adapts it here. Obsidian's `requestUrl` becomes
   * roughly `async (url) => { const r = await requestUrl({ url, throw: false });
   * return new Response(r.text, { status: r.status }); }` — and note
   * `throw: false`, because `requestUrl` throws on 400+ by default, which would
   * turn the 410 above into an exception indistinguishable from being offline.
   */
  fetchImpl?: typeof fetch;
  /**
   * Extra attempts after an `unavailable` answer. Default 1.
   *
   * A retry belongs here rather than with the host because it is a reading of
   * the response — 429 and 5xx are the server saying "not right now", which is
   * different from "no". Anything beyond one retry is a host's patience budget:
   * set 0 when a person is waiting.
   *
   * 🔴 "Not right now" is never answered by asking again right now. A retry
   * waits out the server's `Retry-After` when that fits inside `timeoutMs`, and
   * gives up without asking again when it does not; with no `Retry-After` it
   * waits a jittered `LIVE_LINK_RETRY_DELAY_MS`, doubling per attempt. Until
   * 2026-09-14 the retry went out back-to-back, so every reader of a page
   * doubled the traffic of an API that was shedding load (#804).
   */
  retries?: number;
}

/**
 * Base wait before a retry the server gave no `Retry-After` for. The actual
 * wait is between half and all of it, doubling per attempt — the jitter is so a
 * page of readers who all failed together does not all return together.
 */
export const LIVE_LINK_RETRY_DELAY_MS = 1_000;

/** One attempt's outcome, plus the server's requested wait when it named one. */
interface Attempt {
  result: LiveLinkFetch;
  retryAfterMs?: number;
}

/**
 * `Retry-After` as milliseconds: delta-seconds or an HTTP date.
 *
 * ⚠️ A browser reads this header only if the API lists it in
 * `Access-Control-Expose-Headers` — `retry-after` is not among the headers
 * CORS lets a page read by default, so cross-origin it arrives as `null` and the jittered
 * default applies instead. Node's `fetch` sees it directly; a host adapter
 * sees it only if it copies the headers onto the `Response` it builds.
 */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return undefined;
  return Math.max(0, at - Date.now());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ResolvedFetchOptions {
  base: string | undefined;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  retries: number;
}

function resolveOptions(options: LiveLinkFetchOptions): ResolvedFetchOptions {
  return {
    base: options.base,
    timeoutMs: options.timeoutMs ?? DEFAULT_LIVE_LINK_TIMEOUT_MS,
    fetchImpl:
      options.fetchImpl ??
      (typeof globalThis.fetch === 'function'
        ? globalThis.fetch.bind(globalThis)
        : globalThis.fetch),
    retries: options.retries ?? 1,
  };
}

async function fetchOnce(
  ref: CloudReference,
  opts: ResolvedFetchOptions
): Promise<Attempt> {
  const url = referenceSourceUrl(
    ref,
    opts.base === undefined ? {} : { base: opts.base }
  );
  try {
    // Off the object first, then called — never `opts.fetchImpl(...)`, which
    // would pass `opts` as `this`. See the note where it is bound.
    const { fetchImpl } = opts;
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: { accept: 'application/json' },
    });
    if (res.status === 410) return { result: { kind: 'gone' } };
    if (res.status === 404) return { result: { kind: 'missing' } };
    if (!res.ok) {
      const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
      return {
        result: { kind: 'unavailable', reason: `HTTP ${String(res.status)}` },
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      };
    }
    const body = (await res.json()) as Partial<CloudReferenceSource>;
    // A 200 carrying no source is a broken deploy on our side, not a missing
    // diagram — `unavailable` so the caller keeps whatever copy it has instead
    // of concluding the diagram is gone.
    if (typeof body.source !== 'string') {
      return { result: { kind: 'unavailable', reason: 'malformed response' } };
    }
    return {
      result: {
        kind: 'ok',
        entry: {
          id: ref.id,
          source: body.source,
          dgmoVersion:
            typeof body.dgmoVersion === 'string' ? body.dgmoVersion : '',
          updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : 0,
        },
      },
    };
  } catch (err) {
    return {
      result: {
        kind: 'unavailable',
        reason: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/**
 * Ask the Cloud for a live link's current source, and say what came back.
 *
 * Never throws for anything the Cloud or the network does: every way the fetch
 * can fail is one of the four outcomes, because a caller that has to tell a
 * rejected promise from a 410 will get it wrong.
 *
 * 🔴 The one rejection is a `ref` whose id is not an id (`referenceSourceUrl`
 * throws). No parser produces one, so only a caller that built the reference by
 * hand can reach it, and the rejection's stack names that caller (#772).
 */
export async function fetchLiveLink(
  ref: CloudReference,
  options: LiveLinkFetchOptions = {}
): Promise<LiveLinkFetch> {
  const opts = resolveOptions(options);
  let attempt = await fetchOnce(ref, opts);
  for (
    let i = 0;
    i < opts.retries && attempt.result.kind === 'unavailable';
    i++
  ) {
    let wait: number;
    if (attempt.retryAfterMs !== undefined) {
      // The server named its wait. Longer than this caller's patience means
      // the answer is already known — asking sooner would be asking it to
      // break its own rule.
      if (attempt.retryAfterMs > opts.timeoutMs) break;
      wait = attempt.retryAfterMs;
    } else {
      const window = LIVE_LINK_RETRY_DELAY_MS * 2 ** i;
      wait = window / 2 + Math.floor(Math.random() * (window / 2));
    }
    await sleep(wait);
    attempt = await fetchOnce(ref, opts);
  }
  return attempt.result;
}
