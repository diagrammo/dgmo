import { describe, expect, it } from 'vitest';

import { parseKanban } from '../src/kanban/parser';
import { render } from '../src/render';

const BOARD = `kanban
tag Team
  Backend blue
  Frontend green
[To Do]
  Task 1 team: Backend
  Task 2 team: Frontend`;

describe('kanban `lane-by <group>` directive', () => {
  it('parses the directive into options', () => {
    const parsed = parseKanban(
      BOARD.replace('kanban\n', 'kanban\nlane-by Team\n')
    );
    expect(parsed.options['lane-by']).toBe('Team');
    expect(parseKanban(BOARD).options['lane-by']).toBeUndefined();
  });

  it('render() honors the directive — output differs from the flat board', async () => {
    const withSwim = await render(
      BOARD.replace('kanban\n', 'kanban\nlane-by Team\n'),
      { palette: 'slate' }
    );
    const flat = await render(BOARD, { palette: 'slate' });
    expect(withSwim.svg).toContain('<svg');
    expect(withSwim.svg).not.toBe(flat.svg);
  });
});
