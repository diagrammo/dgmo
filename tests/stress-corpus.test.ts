// The stress corpus gate (#1417). Every fixture under stress/ must render
// without an error and carry a `// stress:` line; one with no `// known:` line
// must also pass every geometry lint. A fixture that shows an open defect
// names it with `// known: diagrammo/diagrammo#<n>`, and the build that fixes
// the defect deletes that line — so the corpus ratchets toward clean.
import { describe, it, expect } from 'vitest';
import { loadCorpus, renderFixture } from './stress/corpus';

const corpus = loadCorpus();
const NAME_RE = /^[a-z0-9-]+\/[a-z0-9-]+--[a-z0-9-]+\.dgmo$/;
const KNOWN_RE = /^diagrammo\/diagrammo#\d+$/;

describe('stress corpus', () => {
  it('is not empty', () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  it.each(corpus.map((f) => [f.id, f] as const))('%s', async (_id, fixture) => {
    expect(fixture.id, 'name is <chart-type>/<dimension>--<slug>.dgmo').toMatch(
      NAME_RE
    );
    expect(
      fixture.intent,
      'needs a `// stress: <dimension> — <what it pushes on>` line'
    ).not.toBe('');
    for (const k of fixture.known) expect(k).toMatch(KNOWN_RE);

    const r = await renderFixture(fixture);
    expect(r.errors).toEqual([]);
    expect(r.svg).not.toBe('');
    if (fixture.known.length === 0) expect(r.findings).toEqual([]);
  });
});
