import { describe, expect, it } from 'vitest';

import { parseMindmap } from '../src/mindmap/parser';
import { render } from '../src/render';

const SRC = `mindmap
Root
  Branch A
    Leaf 1
  Branch B`;

describe('mindmap `color-by-depth` flag', () => {
  it('parses the bare flag into options', () => {
    const parsed = parseMindmap('mindmap\ncolor-by-depth\nRoot\n  Child');
    expect(parsed.options['color-by-depth']).toBe('on');
    expect(parseMindmap(SRC).options['color-by-depth']).toBeUndefined();
  });

  it('render() honors the flag — output differs from the default', async () => {
    const withFlag = await render(
      SRC.replace('mindmap\n', 'mindmap\ncolor-by-depth\n'),
      { palette: 'slate' }
    );
    const withoutFlag = await render(SRC, { palette: 'slate' });
    expect(withFlag.svg).toContain('<svg');
    expect(withFlag.svg).not.toBe(withoutFlag.svg);
  });
});
