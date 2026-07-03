import { describe, expect, it } from 'vitest';

import { parseERDiagram } from '../src/er/parser';
import { render } from '../src/render';

const SRC = `er
User
  id int pk
Order
  id int pk
  user_id int fk`;

describe('er `no-semantic-colors` flag', () => {
  it('parses the bare flag into options', () => {
    const parsed = parseERDiagram(
      SRC.replace('er\n', 'er\nno-semantic-colors\n')
    );
    expect(parsed.options['no-semantic-colors']).toBe('on');
    expect(parseERDiagram(SRC).options['no-semantic-colors']).toBeUndefined();
  });

  it('render() honors the flag — output differs from the semantic default', async () => {
    const withFlag = await render(
      SRC.replace('er\n', 'er\nno-semantic-colors\n'),
      { palette: 'slate' }
    );
    const withoutFlag = await render(SRC, { palette: 'slate' });
    expect(withFlag.svg).toContain('<svg');
    // The flag suppresses role colors, so the two renders are not identical.
    expect(withFlag.svg).not.toBe(withoutFlag.svg);
  });
});
