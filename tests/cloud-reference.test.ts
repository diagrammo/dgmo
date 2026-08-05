/**
 * Live-link resolver (Cloud story 10.6) — three spellings, one parser.
 *
 * The keyword became `live-link` on 2026-08-01 (decision #53); the module and
 * its package subpath keep the old name on purpose.
 *
 * The parity table is the point of this file. Every modifier a reference can
 * carry is declared ONCE and asserted against all three spellings, because a
 * modifier that lands in one form and not the others is the failure this story
 * predicted (A9): the date pin already proved the cost.
 */

import { describe, expect, it } from 'vitest';

import {
  CLOUD_API_BASE,
  type CloudReference,
  parseCloudReference,
  parseCloudReferenceFence,
  parseCloudReferenceEmbed,
  referenceShareUrl,
  referenceSourceUrl,
} from '../src/cloud-reference';

/** One case → three spellings. Add a modifier here and all three must handle it. */
const PARITY: Array<{
  what: string;
  fence: string;
  embed: string;
  url: string;
  expected: CloudReference;
}> = [
  {
    what: 'a reference',
    fence: 'live-link dgm_01HQ3',
    embed: '![[live-link:dgm_01HQ3]]',
    url: 'https://api.diagrammo.app/public/diagrams/dgm_01HQ3/source',
    expected: { id: 'dgm_01HQ3' },
  },
];

describe('three spellings, one reference', () => {
  for (const c of PARITY) {
    it(`${c.what} parses identically in all three forms`, () => {
      expect(parseCloudReference(c.fence)).toEqual(c.expected);
      expect(parseCloudReference(c.embed)).toEqual(c.expected);
      expect(parseCloudReference(c.url)).toEqual(c.expected);
    });
  }

  it('tolerates the whitespace real documents contain', () => {
    expect(parseCloudReference('  live-link   dgm_1  \n')).toEqual({
      id: 'dgm_1',
    });
    expect(parseCloudReference('![[ live-link: dgm_1 ]]')).toEqual({
      id: 'dgm_1',
    });
  });

  it('accepts the share link a person actually has in hand', () => {
    expect(parseCloudReference('https://online.diagrammo.app/d/dgm_1')).toEqual(
      { id: 'dgm_1' }
    );
    expect(
      parseCloudReference('https://online.diagrammo.app/view/dgm_1')
    ).toEqual({ id: 'dgm_1' });
  });
});

describe('what is NOT a reference', () => {
  it('leaves ordinary content alone rather than guessing', () => {
    expect(parseCloudReference('flowchart\n  A -> B')).toBeNull();
    expect(parseCloudReference('live-link')).toBeNull();
    expect(parseCloudReference('![[local-file.dgmo]]')).toBeNull();
    expect(parseCloudReference('live-link dgm_1 extra')).toBeNull();
    expect(parseCloudReference('https://example.com/d/dgm_1/nope')).toBeNull();
    expect(parseCloudReference('not a url at all')).toBeNull();
  });

  it('refuses a PIN in every spelling rather than silently floating', () => {
    // Pinning was dropped 2026-07-30: retained version history is bounded, so a
    // pin would fail on exactly the diagrams people edit most. Resolving a
    // pinned reference anyway would hand a document that asked to be FROZEN the
    // latest revision — the one outcome pinning existed to prevent.
    expect(parseCloudReference('live-link dgm_1@2026-03-12')).toBeNull();
    expect(parseCloudReference('![[live-link:dgm_1@2026-03-12]]')).toBeNull();
    expect(
      parseCloudReference(
        'https://api.diagrammo.app/public/diagrams/dgm_1/source?at=2026-03-12'
      )
    ).toBeNull();
    expect(parseCloudReference('live-link dgm_1@v7')).toBeNull();
  });

  it('bounds the id so a malformed document cannot hand over an essay', () => {
    expect(parseCloudReference(`live-link ${'x'.repeat(65)}`)).toBeNull();
  });
});

describe('resolution', () => {
  it('builds the source URL — no query, always the current revision', () => {
    expect(referenceSourceUrl({ id: 'dgm_1' })).toBe(
      `${CLOUD_API_BASE}/public/diagrams/dgm_1/source`
    );
  });

  it('round-trips: a built URL parses back to the reference it was built from', () => {
    for (const c of PARITY) {
      expect(parseCloudReference(referenceSourceUrl(c.expected))).toEqual(
        c.expected
      );
    }
  });

  it('takes a custom base for self-host and staging, trailing slash or not', () => {
    expect(
      referenceSourceUrl({ id: 'dgm_1' }, { base: 'https://api.example.test/' })
    ).toBe('https://api.example.test/public/diagrams/dgm_1/source');
  });

  it('builds the human share link', () => {
    expect(referenceShareUrl({ id: 'dgm_1' })).toBe(
      'https://online.diagrammo.app/d/dgm_1'
    );
  });
});

describe('the surface-specific parsers (2026-08-05)', () => {
  // The union used to be what every caller reached for, and three of the four
  // wanted "fence". That is how `![[live-link:<id>]]` — host markdown — came to
  // be accepted inside a code fence whose content is DGMO. Each surface now
  // names itself.
  const ID = 'dgm_7f2a91';

  it('a fence takes the keyword form and a plain link, and NOT the note form', () => {
    expect(parseCloudReferenceFence(`live-link ${ID}`)).toEqual({ id: ID });
    expect(
      parseCloudReferenceFence(`https://online.diagrammo.app/d/${ID}`)
    ).toEqual({ id: ID });
    expect(parseCloudReferenceFence(`![[live-link:${ID}]]`)).toBeNull();
  });

  it('the note form takes only itself, brackets included', () => {
    expect(parseCloudReferenceEmbed(`![[live-link:${ID}]]`)).toEqual({
      id: ID,
    });
    expect(parseCloudReferenceEmbed(`live-link ${ID}`)).toBeNull();
    expect(
      parseCloudReferenceEmbed(`https://online.diagrammo.app/d/${ID}`)
    ).toBeNull();
    // Obsidian hands over the inside of the brackets; without them it is not
    // the spelling, and the caller is expected to put them back.
    expect(parseCloudReferenceEmbed(`live-link:${ID}`)).toBeNull();
  });

  it('the union still spans both, for a host scanning raw note text', () => {
    for (const spelling of [
      `live-link ${ID}`,
      `![[live-link:${ID}]]`,
      `https://online.diagrammo.app/d/${ID}`,
    ]) {
      expect(parseCloudReference(spelling), spelling).toEqual({ id: ID });
    }
  });
});
