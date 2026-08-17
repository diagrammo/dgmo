/**
 * `active-tag <name>` naming a group the diagram does not declare.
 *
 * `resolveActiveTagGroup` hands an explicit `active-tag` straight back without
 * consulting the groups, so every caller then fails to find it and quietly
 * renders in flat neutral colours — indistinguishable from a diagram that has
 * no tags at all, and reading as "tags aren't working" rather than "you
 * spelled it wrong". These cover the check that makes it say so.
 */
import { describe, it, expect } from 'vitest';
import { activeTagNoMatchMessage } from '../src/utils/tag-groups';
import { parseOrg } from '../src/org/parser';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { parseMindmap } from '../src/mindmap/parser';
import { parseMap } from '../src/map/parser';

const groups = (...names: string[]): Array<{ name: string }> =>
  names.map((name) => ({ name }));

const CODE = 'W_ACTIVE_TAG_NO_MATCH';

/** The active-tag diagnostics of a parse, by code. */
function activeTagDiags(parsed: {
  diagnostics?: ReadonlyArray<{ code?: string; line: number; message: string }>;
}): ReadonlyArray<{ code?: string; line: number; message: string }> {
  return (parsed.diagnostics ?? []).filter((d) => d.code === CODE);
}

describe('activeTagNoMatchMessage — the shared check', () => {
  it('reports a name no declared group carries, with a did-you-mean', () => {
    const msg = activeTagNoMatchMessage('Rnak', groups('Rank', 'Ship'));
    expect(msg).toContain(
      'active-tag "Rnak" does not match a declared tag group'
    );
    expect(msg).toContain('Available: Rank, Ship, none.');
    expect(msg).toContain("Did you mean 'Rank'?");
  });

  it('says so plainly when the diagram declares no groups at all', () => {
    const msg = activeTagNoMatchMessage('Rank', []);
    expect(msg).toContain('No tag groups are declared.');
    expect(msg).not.toContain('Did you mean');
  });

  it('matches a declared group case-insensitively', () => {
    expect(activeTagNoMatchMessage('rank', groups('Rank'))).toBeNull();
    expect(activeTagNoMatchMessage('RANK', groups('Rank'))).toBeNull();
  });

  it('never fires on the reserved value `none`', () => {
    expect(activeTagNoMatchMessage('none', groups('Rank'))).toBeNull();
    expect(activeTagNoMatchMessage('None', [])).toBeNull();
  });

  it('never fires when there is no active-tag to check', () => {
    expect(activeTagNoMatchMessage(undefined, groups('Rank'))).toBeNull();
    expect(activeTagNoMatchMessage('', groups('Rank'))).toBeNull();
    expect(activeTagNoMatchMessage('   ', groups('Rank'))).toBeNull();
  });

  it('accepts a chart-specific extra target and names it in the message', () => {
    expect(
      activeTagNoMatchMessage(
        'Sales',
        groups('Rank'),
        ['Sales'],
        'the value ramp'
      )
    ).toBeNull();
    const msg = activeTagNoMatchMessage(
      'Salez',
      groups('Rank'),
      ['Sales'],
      'the value ramp'
    );
    expect(msg).toContain('a declared tag group or the value ramp');
    expect(msg).toContain('Available: Rank, Sales, none.');
    expect(msg).toContain("Did you mean 'Sales'?");
  });

  it('accepts BOTH the raw name and its slug for a spaced group', () => {
    // The spec addresses a quoted group by its DOM-safe slug (§1.4 Name), and
    // several renderers match the raw name case-insensitively instead. Both
    // colour something somewhere, so a warning must accept both — a false
    // positive on a diagram that renders correctly is the damaging kind.
    expect(
      activeTagNoMatchMessage('Trust Zone', groups('Trust Zone'))
    ).toBeNull();
    expect(
      activeTagNoMatchMessage('trust-zone', groups('Trust Zone'))
    ).toBeNull();
    expect(
      activeTagNoMatchMessage('crew % (naïve)', groups('Crew % (naïve)'))
    ).toBeNull();
    expect(
      activeTagNoMatchMessage('crew-na-ve', groups('Crew % (naïve)'))
    ).toBeNull();
    // Still reports something that is neither spelling.
    expect(
      activeTagNoMatchMessage('Trust Zonk', groups('Trust Zone'))
    ).not.toBeNull();
  });
});

describe('active-tag no-match — through the parsers', () => {
  it('org warns, on the directive’s own line, with the code', () => {
    const parsed = parseOrg(
      'org Crew\nactive-tag Rnak\n\ntag Rank as r\n  Captain red\n  Sailor blue\n\nBlackbeard r: Captain\n'
    );
    const diags = activeTagDiags(parsed);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.line).toBe(2);
    expect(diags[0]!.message).toContain("Did you mean 'Rank'?");
  });

  it('sequence warns too — this is not one chart type’s problem', () => {
    const parsed = parseSequenceDgmo(
      'sequence\nactive-tag Dek\n\ntag Deck as d\n  Gun blue\n\nA d: Gun\nB\nA -hi-> B\n'
    );
    const diags = activeTagDiags(parsed);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.line).toBe(2);
    expect(diags[0]!.message).toContain("Did you mean 'Deck'?");
  });

  it('mindmap warns', () => {
    const parsed = parseMindmap(
      'mindmap Root\nactive-tag Prioriti\n\ntag Priority as p\n  High red\n\nRoot\n  Child p: High\n'
    );
    expect(activeTagDiags(parsed)).toHaveLength(1);
  });

  it('stays silent on a correct name, and on `none`', () => {
    const ok = parseOrg(
      'org Crew\nactive-tag Rank\n\ntag Rank as r\n  Captain red\n\nBlackbeard r: Captain\n'
    );
    expect(activeTagDiags(ok)).toHaveLength(0);

    const none = parseOrg(
      'org Crew\nactive-tag none\n\ntag Rank as r\n  Captain red\n\nBlackbeard r: Captain\n'
    );
    expect(activeTagDiags(none)).toHaveLength(0);
  });

  it('stays silent on a group DECLARED but empty', () => {
    // Renderers narrow the group list to `entries.length > 0`. Checking against
    // that filtered list would report a group the author can plainly see.
    const parsed = parseOrg(
      'org Crew\nactive-tag Rank\n\ntag Rank as r\n\nBlackbeard\n'
    );
    expect(activeTagDiags(parsed)).toHaveLength(0);
  });

  it('warns when the diagram declares no groups at all', () => {
    const parsed = parseOrg(
      'org Crew\nactive-tag Rank\n\nBlackbeard\n  Anne\n'
    );
    const diags = activeTagDiags(parsed);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain('No tag groups are declared.');
  });
});

describe('map — the two bugs its hand-rolled check had', () => {
  it('accepts the value ramp as an active-tag target', () => {
    // `region-heat Sales` names the choropleth ramp, which is a legitimate
    // colouring dimension alongside the tag groups. The old check never
    // admitted it, so this warned falsely.
    const parsed = parseMap(
      'map\nregion-heat Sales\nactive-tag Sales\n\nCalifornia heat: 92\nTexas heat: 41\n'
    );
    expect(activeTagDiags(parsed)).toHaveLength(0);
  });

  it('accepts either spelling of a spaced group name', () => {
    // `map/layout.ts` matches the raw name; the spec names the slug. The old
    // check accepted only the slug, so it disagreed with its own renderer.
    const bySlug = parseMap(
      'map\nactive-tag trust-zone\n\ntag "Trust Zone" as tz\n  Edge red\n\nCalifornia tz: Edge\n'
    );
    expect(activeTagDiags(bySlug)).toHaveLength(0);
    const byName = parseMap(
      'map\nactive-tag Trust Zone\n\ntag "Trust Zone" as tz\n  Edge red\n\nCalifornia tz: Edge\n'
    );
    expect(activeTagDiags(byName)).toHaveLength(0);
  });

  it('still warns on a name that is neither a group nor the ramp', () => {
    const parsed = parseMap(
      'map\nregion-heat Sales\nactive-tag Nonsense\n\nCalifornia heat: 92\n'
    );
    expect(activeTagDiags(parsed)).toHaveLength(1);
  });
});
