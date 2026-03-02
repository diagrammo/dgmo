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
        isReturn: false,
      });
    });

    it('multi-word label', () => {
      const r = parseArrow('User -send request-> API');
      expect(r).toEqual({
        from: 'User',
        to: 'API',
        label: 'send request',
        async: false,
        isReturn: false,
      });
    });

    it('extra whitespace around arrow', () => {
      const r = parseArrow('A  -msg->  B');
      expect(r).toEqual({
        from: 'A',
        to: 'B',
        label: 'msg',
        async: false,
        isReturn: false,
      });
    });

    it('brackets in label', () => {
      const r = parseArrow('App -Makes calls [JSON/HTTPS]-> API');
      expect(r).toEqual({
        from: 'App',
        to: 'API',
        label: 'Makes calls [JSON/HTTPS]',
        async: false,
        isReturn: false,
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
        isReturn: false,
      });
    });

    it('multi-word label', () => {
      const r = parseArrow('Service ~send notification~> Worker');
      expect(r).toEqual({
        from: 'Service',
        to: 'Worker',
        label: 'send notification',
        async: true,
        isReturn: false,
      });
    });
  });

  // ---- Sync return: <-label- ----
  describe('sync return (<-label-)', () => {
    it('basic form', () => {
      const r = parseArrow('A <-response- B');
      expect(r).toEqual({
        from: 'B',
        to: 'A',
        label: 'response',
        async: false,
        isReturn: true,
      });
    });

    it('multi-word label', () => {
      const r = parseArrow('Client <-200 OK- Server');
      expect(r).toEqual({
        from: 'Server',
        to: 'Client',
        label: '200 OK',
        async: false,
        isReturn: true,
      });
    });

    it('extra whitespace around arrow', () => {
      const r = parseArrow('A  <-msg-  B');
      expect(r).toEqual({
        from: 'B',
        to: 'A',
        label: 'msg',
        async: false,
        isReturn: true,
      });
    });
  });

  // ---- Async return: <~label~ ----
  describe('async return (<~label~)', () => {
    it('basic form', () => {
      const r = parseArrow('A <~result~ B');
      expect(r).toEqual({
        from: 'B',
        to: 'A',
        label: 'result',
        async: true,
        isReturn: true,
      });
    });

    it('multi-word label', () => {
      const r = parseArrow('Client <~batch result~ Worker');
      expect(r).toEqual({
        from: 'Worker',
        to: 'Client',
        label: 'batch result',
        async: true,
        isReturn: true,
      });
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

  // ---- Error cases ----
  describe('error on arrow chars inside label', () => {
    it('-> inside label', () => {
      const r = parseArrow('A -routes->next-> B');
      expect(r).toHaveProperty('error');
      expect((r as { error: string }).error).toContain('not allowed');
    });

    it('~> inside label', () => {
      const r = parseArrow('A -has~>val-> B');
      expect(r).toHaveProperty('error');
    });

    it('<- inside return label', () => {
      const r = parseArrow('A <-bad<-val- B');
      expect(r).toHaveProperty('error');
    });
  });
});
