import { describe, it, expect } from 'vitest';
import { parseArrow } from '../src/utils/arrows';

describe('parseArrow — labeled arrow utility', () => {
  // ---- Sync labeled: -label-> ----
  describe('sync labeled (-label->)', () => {
    it('basic form', () => {
      const r = parseArrow('A -login-> B');
      expect(r).toEqual({
        from: 'A',
        to: 'B',
        label: 'login',
        async: false,
      });
    });

    it('multi-word label', () => {
      const r = parseArrow('User -send request-> API');
      expect(r).toEqual({
        from: 'User',
        to: 'API',
        label: 'send request',
        async: false,
      });
    });

    it('extra whitespace around arrow', () => {
      const r = parseArrow('A  -msg->  B');
      expect(r).toEqual({
        from: 'A',
        to: 'B',
        label: 'msg',
        async: false,
      });
    });

    it('brackets in label', () => {
      const r = parseArrow('App -Makes calls [JSON/HTTPS]-> API');
      expect(r).toEqual({
        from: 'App',
        to: 'API',
        label: 'Makes calls [JSON/HTTPS]',
        async: false,
      });
    });
  });

  // ---- Async labeled: ~label~> ----
  describe('async labeled (~label~>)', () => {
    it('basic form', () => {
      const r = parseArrow('API ~event~> Queue');
      expect(r).toEqual({
        from: 'API',
        to: 'Queue',
        label: 'event',
        async: true,
      });
    });

    it('multi-word label', () => {
      const r = parseArrow('Service ~send notification~> Worker');
      expect(r).toEqual({
        from: 'Service',
        to: 'Worker',
        label: 'send notification',
        async: true,
      });
    });
  });

  // ---- Deprecated return arrows produce errors ----
  describe('return arrows (<-label-) produce errors', () => {
    it('sync return produces error with migration hint', () => {
      const r = parseArrow('A <-response- B');
      expect(r).toHaveProperty('error');
      expect((r as { error: string }).error).toContain('no longer supported');
      expect((r as { error: string }).error).toContain("'B -response-> A'");
    });

    it('async return produces error', () => {
      const r = parseArrow('Client <-200 OK- Server');
      expect(r).toHaveProperty('error');
      expect((r as { error: string }).error).toContain('no longer supported');
    });
  });

  // ---- Bidi errors ----
  describe('bidirectional arrows produce errors', () => {
    it('<-label-> produces error', () => {
      const r = parseArrow('A <-data sync-> B');
      expect(r).toHaveProperty('error');
      expect((r as { error: string }).error).toContain('no longer supported');
    });

    it('<~label~> produces error', () => {
      const r = parseArrow('A <~heartbeat~> B');
      expect(r).toHaveProperty('error');
      expect((r as { error: string }).error).toContain('no longer supported');
    });
  });

  // ---- Whitespace flexibility around arrows ----
  describe('whitespace is optional around arrows', () => {
    it('no spaces: A-login->B', () => {
      const r = parseArrow('A-login->B');
      expect(r).toEqual({ from: 'A', to: 'B', label: 'login', async: false });
    });

    it('no leading space: A-login-> B', () => {
      const r = parseArrow('A-login-> B');
      expect(r).toEqual({ from: 'A', to: 'B', label: 'login', async: false });
    });

    it('async no spaces: API~event~>Queue', () => {
      const r = parseArrow('API~event~>Queue');
      expect(r).toEqual({
        from: 'API',
        to: 'Queue',
        label: 'event',
        async: true,
      });
    });

    it('async mixed spacing: API~event~> Queue', () => {
      const r = parseArrow('API~event~> Queue');
      expect(r).toEqual({
        from: 'API',
        to: 'Queue',
        label: 'event',
        async: true,
      });
    });
  });

  // ---- Dashes in labels ----
  describe('dashes in labels', () => {
    it('label with inner dashes: A -pre-process-> B', () => {
      const r = parseArrow('A -pre-process-> B');
      expect(r).toEqual({
        from: 'A',
        to: 'B',
        label: 'pre-process',
        async: false,
      });
    });

    it('multi-word hyphenated label', () => {
      const r = parseArrow('Client -re-auth token-> Server');
      expect(r).toEqual({
        from: 'Client',
        to: 'Server',
        label: 're-auth token',
        async: false,
      });
    });

    it('hyphenated to name: A -call-> my-api', () => {
      const r = parseArrow('A -call-> my-api');
      expect(r).toEqual({
        from: 'A',
        to: 'my-api',
        label: 'call',
        async: false,
      });
    });

    it('async hyphenated label: A ~re-sync~> B', () => {
      const r = parseArrow('A ~re-sync~> B');
      expect(r).toEqual({ from: 'A', to: 'B', label: 're-sync', async: true });
    });
  });

  // ---- Not a labeled arrow → null ----
  describe('returns null for non-labeled arrows', () => {
    it('plain sync arrow', () => {
      expect(parseArrow('A -> B')).toBeNull();
    });

    it('plain async arrow', () => {
      expect(parseArrow('A ~> B')).toBeNull();
    });

    it('plain with colon label', () => {
      expect(parseArrow('A -> B: message')).toBeNull();
    });

    it('empty label (--> B) falls through to null', () => {
      expect(parseArrow('A --> B')).toBeNull();
    });

    it('bare return arrow', () => {
      expect(parseArrow('A <- B')).toBeNull();
    });

    it('random text', () => {
      expect(parseArrow('hello world')).toBeNull();
    });
  });

  // ---- Arrow-char-in-label validation (moved to parseInArrowLabel) ----
  //
  // Post-TD-13: `parseArrow` no longer emits "arrow chars inside labels"
  // as an error. That validation lives in `validateLabelCharacters`
  // (imported via `parseInArrowLabel`) so it emits the stable
  // `E_ARROW_SUBSTRING_IN_LABEL` diagnostic code from the unified registry.
  // Callers of `parseArrow` are expected to route the returned label
  // through `parseInArrowLabel` — sequence's parser does exactly this at
  // `src/sequence/parser.ts:945-948`.
  describe('TD-13 validation moved to parseInArrowLabel', () => {
    it('parseArrow itself no longer rejects -> inside label text', () => {
      // In practice this path is unreachable because non-greedy source
      // match + greedy target match absorbs the inner `->` into one of
      // the capture groups. We assert only that parseArrow does not emit
      // the legacy `{error: "...not allowed..."}` return.
      const r = parseArrow('A -routes->next-> B');
      if (r && 'error' in r) {
        expect(r.error).not.toContain('not allowed');
      }
    });
  });
});
