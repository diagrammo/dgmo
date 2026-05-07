import { describe, it, expect } from 'vitest';
import {
  aliasBeforeDeclMessage,
  aliasCollisionMessage,
  aliasShadowsNameMessage,
  aliasRebindingMessage,
  aliasOfAliasMessage,
  aliasReservedKeywordMessage,
  aliasInvalidFormatMessage,
  aliasAfterCanonicalMessage,
  tagShorthandRemovedMessage,
  vennAliasKeywordRemovedMessage,
  aliasCaseNearMatchMessage,
  aliasUnderusedMessage,
} from '../src/diagnostics';

// ============================================================
// Diagnostic message UX (Q4 / M2)
// ============================================================
//
// Per M2: structured assertions instead of brittle snapshots.
// Each message must carry the alias token AND/OR the relevant
// canonical context AND should suggest a fix where applicable.

describe('alias diagnostic messages — UX contract', () => {
  it('E_ALIAS_BEFORE_DECL: contains the token and a suggestion verb', () => {
    const msg = aliasBeforeDeclMessage('pm');
    expect(msg).toContain('pm');
    expect(msg).toContain('Declare');
  });

  it('E_ALIAS_COLLISION: names both bindings + line of the existing one', () => {
    const msg = aliasCollisionMessage({
      token: 'pm',
      existingCanonical: 'Product Manager',
      existingLine: 3,
      incomingCanonical: 'Project Manager',
    });
    expect(msg).toContain('pm');
    expect(msg).toContain('Product Manager');
    expect(msg).toContain('Project Manager');
    expect(msg).toContain('line 3');
  });

  it('E_ALIAS_SHADOWS_NAME: names the alias literal + suggests a fix', () => {
    const msg = aliasShadowsNameMessage('Bar');
    expect(msg).toContain('Bar');
    expect(msg).toMatch(/choose|pick|use/i);
  });

  it('E_ALIAS_REBINDING: names canonical + both aliases + existing line', () => {
    const msg = aliasRebindingMessage({
      canonical: 'Product Manager',
      existingAlias: 'pm',
      existingLine: 5,
      incomingAlias: 'boss',
    });
    expect(msg).toContain('Product Manager');
    expect(msg).toContain('pm');
    expect(msg).toContain('boss');
    expect(msg).toContain('line 5');
  });

  it('E_ALIAS_OF_ALIAS: explains the canonical and suggests aliasing it instead', () => {
    const msg = aliasOfAliasMessage({
      token: 'pm',
      canonical: 'Product Manager',
    });
    expect(msg).toContain('pm');
    expect(msg).toContain('Product Manager');
    expect(msg).toMatch(/canonical|alias an alias/i);
  });

  it('E_ALIAS_RESERVED_KEYWORD: identifies the offending token', () => {
    const msg = aliasReservedKeywordMessage('as');
    expect(msg).toContain('as');
    expect(msg).toMatch(/reserved/i);
  });

  it('E_ALIAS_INVALID_FORMAT: states the regex contract', () => {
    const msg = aliasInvalidFormatMessage('1pm');
    expect(msg).toContain('1pm');
    expect(msg).toMatch(/A-Za-z|letter start/);
  });

  it('E_ALIAS_AFTER_CANONICAL: names canonical and existing line', () => {
    const msg = aliasAfterCanonicalMessage({
      canonical: 'Product Manager',
      existingLine: 4,
    });
    expect(msg).toContain('Product Manager');
    expect(msg).toContain('line 4');
    expect(msg).toMatch(/before|first use/i);
  });

  it('E_TAG_SHORTHAND_REMOVED: shows both legacy and replacement form', () => {
    const msg = tagShorthandRemovedMessage({ name: 'Priority', alias: 'p' });
    expect(msg).toContain('Priority');
    expect(msg).toContain('p');
    expect(msg).toContain('as');
  });

  it('E_VENN_ALIAS_KEYWORD_REMOVED: shows the canonical replacement form', () => {
    const msg = vennAliasKeywordRemovedMessage({
      name: 'Swordsmanship(red)',
      alias: 'sw',
    });
    expect(msg).toContain('Swordsmanship');
    expect(msg).toContain('sw');
    expect(msg).toContain('as');
  });

  it('W_ALIAS_CASE_NEAR_MATCH: includes did-you-mean phrasing', () => {
    const msg = aliasCaseNearMatchMessage({ reference: 'pm', declared: 'PM' });
    expect(msg).toContain('pm');
    expect(msg).toContain('PM');
    expect(msg).toMatch(/did you mean/i);
  });

  it('W_ALIAS_UNDERUSED: names the alias and explains the threshold', () => {
    const msg = aliasUnderusedMessage('pm');
    expect(msg).toContain('pm');
    expect(msg).toMatch(/3\+|earn/i);
  });
});
