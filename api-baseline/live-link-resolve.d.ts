import { CloudReferenceSource, CloudReference } from './cloud-reference.js';

/** Default per-request timeout. A build waits; a reader should not. */
declare const DEFAULT_LIVE_LINK_TIMEOUT_MS = 10000;
/**
 * What the source endpoint said, once it has been read.
 *
 * Four outcomes, and the split is the whole point — a host that cannot tell
 * `gone` from `unavailable` will either keep publishing something its author
 * withdrew, or throw away a good copy because a wifi hotspot ate one request.
 */
type LiveLinkFetch = 
/** 200, and the body was the shape we expect. */
{
    kind: 'ok';
    entry: CloudReferenceSource;
}
/** 410 — the author withdrew it. Deliberate, and not a failure. */
 | {
    kind: 'gone';
}
/** 404 — no such published diagram. A typo, or never published. */
 | {
    kind: 'missing';
}
/** Network, timeout, 5xx, 429, or a body we could not read. Try again later. */
 | {
    kind: 'unavailable';
    reason: string;
};
interface LiveLinkFetchOptions {
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
     */
    retries?: number;
}
/**
 * Ask the Cloud for a live link's current source, and say what came back.
 *
 * Never throws: every way this can fail is one of the four outcomes, because a
 * caller that has to tell a rejected promise from a 410 will get it wrong.
 */
declare function fetchLiveLink(ref: CloudReference, options?: LiveLinkFetchOptions): Promise<LiveLinkFetch>;

export { DEFAULT_LIVE_LINK_TIMEOUT_MS, type LiveLinkFetch, type LiveLinkFetchOptions, fetchLiveLink };
