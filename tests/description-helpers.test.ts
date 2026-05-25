import { describe, it, expect } from 'vitest';
import {
  tryStripDescriptionKeyword,
  preprocessDescriptionLine,
} from '../src/utils/description-helpers';

describe('tryStripDescriptionKeyword', () => {
  it('strips "description: some text" (colon form)', () => {
    const result = tryStripDescriptionKeyword('description: some text');
    expect(result).toEqual({ isKeyword: true, text: 'some text' });
  });

  it('bare form "description text" returns needsColon: true', () => {
    const result = tryStripDescriptionKeyword('description some text');
    expect(result).toEqual({
      isKeyword: true,
      needsColon: true,
      text: 'some text',
    });
  });

  it('is case insensitive (colon form)', () => {
    const result = tryStripDescriptionKeyword('Description: TEXT');
    expect(result).toEqual({ isKeyword: true, text: 'TEXT' });
  });

  it('is case insensitive (bare form → needsColon)', () => {
    const result = tryStripDescriptionKeyword('Description TEXT');
    expect(result).toEqual({
      isKeyword: true,
      needsColon: true,
      text: 'TEXT',
    });
  });

  it('bare "Description" with no trailing text returns isKeyword: false', () => {
    const result = tryStripDescriptionKeyword('Description');
    expect(result).toEqual({ isKeyword: false, text: 'Description' });
  });

  it('regular text returns isKeyword: false', () => {
    const result = tryStripDescriptionKeyword('regular text');
    expect(result).toEqual({ isKeyword: false, text: 'regular text' });
  });
});

describe('preprocessDescriptionLine', () => {
  it('converts "- bullet text" to bullet character', () => {
    expect(preprocessDescriptionLine('- bullet text')).toBe(
      '\u2022 bullet text'
    );
  });

  it('normalizes "http example.com" to "https://example.com"', () => {
    expect(preprocessDescriptionLine('http example.com')).toBe(
      'https://example.com'
    );
  });

  it('returns plain text unchanged', () => {
    expect(preprocessDescriptionLine('plain text')).toBe('plain text');
  });
});
