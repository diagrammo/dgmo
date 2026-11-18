import { describe, it, expect } from 'vitest';
import { parseSequenceDgmo } from '../src/sequence/parser';

const msgs = (src: string) => {
  const r = parseSequenceDgmo(src);
  return {
    r,
    m: r.messages.map((x) => [x.from, x.to, x.label, x.async ?? false]),
  };
};

describe('sequence participant names containing a dash', () => {
  it('keeps dashes in bare arrow names (issue 2077)', () => {
    const { r, m } = msgs(
      'sequence OnSales\n\nBrowser -> AkamaiCDN\nAkamaiCDN -> AdkamaiWR\nMPV-NGINX -> MPV-Core\n'
    );
    expect(r.error).toBeFalsy();
    expect(m[2]).toEqual(['MPV-NGINX', 'MPV-Core', '', false]);
    const ids = r.participants.map((p) => p.id);
    expect(ids).toContain('MPV-NGINX');
    expect(ids).toContain('MPV-Core');
    expect(ids).not.toContain('MPV');
  });

  it('keeps dashes in names around labeled arrows', () => {
    const { m } = msgs(
      'sequence T\n\nMPV-NGINX -get-> MPV-Core\nMPV-Core -pre-fetch data-> DB-1\nMPV-Core ~notify~> Q-Worker\n'
    );
    expect(m[0]).toEqual(['MPV-NGINX', 'MPV-Core', 'get', false]);
    expect(m[1]).toEqual(['MPV-Core', 'DB-1', 'pre-fetch data', false]);
    expect(m[2]).toEqual(['MPV-Core', 'Q-Worker', 'notify', true]);
  });

  it('keeps dashes in async bare arrows', () => {
    const { m } = msgs('sequence T\n\nA-1 ~> B-2\n');
    expect(m[0]).toEqual(['A-1', 'B-2', '', true]);
  });

  it('handles declarations, groups and notes with dashed names', () => {
    const { r, m } = msgs(
      'sequence T\n\n[Edge-Tier]\n  MPV-NGINX\n  MPV-Core\n\nMPV-NGINX -call-> MPV-Core\nnote right of MPV-Core: hello\n'
    );
    expect(r.error).toBeFalsy();
    expect(m[0]).toEqual(['MPV-NGINX', 'MPV-Core', 'call', false]);
    expect(r.groups[0]!.participantIds).toEqual(['MPV-NGINX', 'MPV-Core']);
    expect(JSON.stringify(r.elements)).toContain('MPV-Core');
  });

  it('still rejects the removed left-pointing arrow', () => {
    const r = parseSequenceDgmo('sequence T\n\nMPV-Core <- MPV-NGINX\n');
    expect(r.diagnostics.some((d) => /Left-pointing/.test(d.message))).toBe(
      true
    );
  });
});
