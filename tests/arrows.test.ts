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
        bidirectional: false,
      });
    });

    it('multi-word label', () => {
      const r = parseArrow('User -send request-> API');
      expect(r).toEqual({
        from: 'User',
        to: 'API',
        label: 'send request',
        async: false,
        bidirectional: false,
      });
    });

    it('extra whitespace around arrow', () => {
      const r = parseArrow('A  -msg->  B');
      expect(r).toEqual({
        from: 'A',
        to: 'B',
        label: 'msg',
        async: false,
        bidirectional: false,
      });
    });

    it('brackets in label', () => {
      const r = parseArrow('App -Makes calls [JSON/HTTPS]-> API');
      expect(r).toEqual({
        from: 'App',
        to: 'API',
        label: 'Makes calls [JSON/HTTPS]',
        async: false,
        bidirectional: false,
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
        bidirectional: false,
      });
    });

    it('multi-word label', () => {
      const r = parseArrow('Service ~send notification~> Worker');
      expect(r).toEqual({
        from: 'Service',
        to: 'Worker',
        label: 'send notification',
        async: true,
        bidirectional: false,
      });
    });
  });

  // ---- Bidi sync labeled: <-label-> ----
  describe('bidi sync labeled (<-label->)', () => {
    it('basic form', () => {
      const r = parseArrow('A <-data sync-> B');
      expect(r).toEqual({
        from: 'A',
        to: 'B',
        label: 'data sync',
        async: false,
        bidirectional: true,
      });
    });
  });

  // ---- Bidi async labeled: <~label~> ----
  describe('bidi async labeled (<~label~>)', () => {
    it('basic form', () => {
      const r = parseArrow('A <~heartbeat~> B');
      expect(r).toEqual({
        from: 'A',
        to: 'B',
        label: 'heartbeat',
        async: true,
        bidirectional: true,
      });
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

    it('<-> inside label', () => {
      const r = parseArrow('A <-test<->val-> B');
      expect(r).toHaveProperty('error');
    });
  });
});
