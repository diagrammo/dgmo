// live-link resolve — the fetch step, moved out of remark-dgmo 2026-08-04.
//
// One case per outcome, because the whole value of this module is that a caller
// can tell them apart: a host that reads `gone` as `unavailable` keeps
// publishing a diagram its author withdrew, and one that reads `unavailable` as
// `missing` throws away a good cached copy over one dropped request.
//
// 🔴 The default path is tested with a double that fails the way the real thing
// fails. Every test of the browser half injected a `vi.fn()` — an ordinary
// function with no opinion about `this` — so a `fetch` called as a method
// passed in CI and threw `Illegal invocation` in every browser for the
// feature's entire lifetime. A plain spy cannot catch that class of bug.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchLiveLink,
  DEFAULT_LIVE_LINK_TIMEOUT_MS,
} from '../src/live-link/resolve';

const REF = { id: 'dgm_7f2a91' };

/** A response the module will accept. */
const ok = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const SOURCE = { source: 'pie Treasure', dgmoVersion: '0.59.0', updatedAt: 17 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchLiveLink — the four outcomes', () => {
  it('200 with a body yields the source and the id it was asked for', async () => {
    const r = await fetchLiveLink(REF, { fetchImpl: async () => ok(SOURCE) });
    expect(r).toEqual({
      kind: 'ok',
      entry: { id: 'dgm_7f2a91', ...SOURCE },
    });
  });

  it('410 is `gone` — withdrawn, which is deliberate and not a failure', async () => {
    const r = await fetchLiveLink(REF, {
      fetchImpl: async () => new Response('', { status: 410 }),
    });
    expect(r).toEqual({ kind: 'gone' });
  });

  it('404 is `missing` — a typo, or never published', async () => {
    const r = await fetchLiveLink(REF, {
      fetchImpl: async () => new Response('', { status: 404 }),
    });
    expect(r).toEqual({ kind: 'missing' });
  });

  it('a thrown network error is `unavailable`, never a rejection', async () => {
    const r = await fetchLiveLink(REF, {
      retries: 0,
      fetchImpl: () => Promise.reject(new Error('getaddrinfo ENOTFOUND')),
    });
    expect(r.kind).toBe('unavailable');
    expect(r).toMatchObject({ reason: expect.stringContaining('ENOTFOUND') });
  });

  it('a 5xx is `unavailable` and names the status', async () => {
    const r = await fetchLiveLink(REF, {
      retries: 0,
      fetchImpl: async () => new Response('', { status: 503 }),
    });
    expect(r).toEqual({ kind: 'unavailable', reason: 'HTTP 503' });
  });

  it('200 with no source is `unavailable`, NOT `missing`', async () => {
    // A broken deploy on our side must not read as "the diagram is gone" — the
    // caller has to keep whatever copy it already had.
    const r = await fetchLiveLink(REF, {
      retries: 0,
      fetchImpl: async () => ok({ updatedAt: 17 }),
    });
    expect(r).toEqual({ kind: 'unavailable', reason: 'malformed response' });
  });

  it('a missing dgmoVersion / updatedAt degrade rather than fail', async () => {
    const r = await fetchLiveLink(REF, {
      fetchImpl: async () => ok({ source: 'pie Treasure' }),
    });
    expect(r).toMatchObject({
      kind: 'ok',
      entry: { source: 'pie Treasure', dgmoVersion: '', updatedAt: 0 },
    });
  });
});

describe('fetchLiveLink — retries', () => {
  it('retries once by default on `unavailable`, and a second answer wins', async () => {
    let calls = 0;
    const r = await fetchLiveLink(REF, {
      fetchImpl: async () => {
        calls++;
        return calls === 1 ? new Response('', { status: 429 }) : ok(SOURCE);
      },
    });
    expect(calls).toBe(2);
    expect(r.kind).toBe('ok');
  });

  it('does NOT retry a 404 or a 410 — those are answers, not outages', async () => {
    for (const status of [404, 410]) {
      let calls = 0;
      await fetchLiveLink(REF, {
        fetchImpl: async () => {
          calls++;
          return new Response('', { status });
        },
      });
      expect(calls, String(status)).toBe(1);
    }
  });

  it('retries: 0 makes one attempt — the setting a waiting reader needs', async () => {
    let calls = 0;
    await fetchLiveLink(REF, {
      retries: 0,
      fetchImpl: async () => {
        calls++;
        return new Response('', { status: 503 });
      },
    });
    expect(calls).toBe(1);
  });
});

describe('fetchLiveLink — the request it makes', () => {
  it('asks the public source endpoint, and honours a custom base', async () => {
    const seen: string[] = [];
    const spy = async (url: string | URL | Request): Promise<Response> => {
      seen.push(String(url));
      return ok(SOURCE);
    };
    await fetchLiveLink(REF, { fetchImpl: spy });
    await fetchLiveLink(REF, { fetchImpl: spy, base: 'http://localhost:8787' });
    expect(seen).toEqual([
      'https://api.diagrammo.app/public/diagrams/dgm_7f2a91/source',
      'http://localhost:8787/public/diagrams/dgm_7f2a91/source',
    ]);
  });

  it('carries a timeout signal, defaulting to the documented value', async () => {
    let init: RequestInit | undefined;
    await fetchLiveLink(REF, {
      fetchImpl: async (_url, i) => {
        init = i;
        return ok(SOURCE);
      },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(DEFAULT_LIVE_LINK_TIMEOUT_MS).toBe(10_000);
  });

  it('a timeout arrives as `unavailable`, not as a rejection', async () => {
    const r = await fetchLiveLink(REF, {
      retries: 0,
      timeoutMs: 1,
      fetchImpl: (_url, i) =>
        new Promise((_resolve, reject) => {
          i?.signal?.addEventListener('abort', () =>
            reject(new Error('The operation was aborted'))
          );
        }),
    });
    expect(r.kind).toBe('unavailable');
  });
});

describe('fetchLiveLink — the default fetch is called as a function, not a method', () => {
  // 🔴 The regression this file exists for. `fetch` is a WebIDL operation whose
  // `this` must be the global; held on an options bag and called as
  // `opts.fetchImpl(url)` it throws `Illegal invocation`. Node tolerates a wrong
  // `this`, so this asserts on `this` DIRECTLY rather than hoping the runtime
  // objects — which is the only way a Node test can speak for a browser.
  it('the global default sees the global as `this`', async () => {
    const seen: unknown[] = [];
    vi.stubGlobal('fetch', function (this: unknown): Promise<Response> {
      seen.push(this);
      return Promise.resolve(ok(SOURCE));
    } as unknown as typeof fetch);
    const r = await fetchLiveLink(REF);
    expect(r.kind).toBe('ok');
    // Bound to the global, so `this` is the global — never the options object.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(globalThis);
  });

  it('an INJECTED impl is also called with no options object as `this`', async () => {
    const seen: unknown[] = [];
    const impl = function (this: unknown): Promise<Response> {
      seen.push(this);
      return Promise.resolve(ok(SOURCE));
    } as unknown as typeof fetch;
    await fetchLiveLink(REF, { fetchImpl: impl, base: 'https://example.test' });
    expect(seen[0]).toBeUndefined();
  });
});
