import { describe, expect, it } from 'vitest';

import { parseKanban } from '../src/kanban/parser';
import { render } from '../src/render';

const SRC = `kanban
[To Do] collapsed: true
  Task 1
[Done]
  Task 2`;

describe('kanban `[Column] collapsed: true` marker', () => {
  it('parses the marker into a typed column field, not metadata', () => {
    const parsed = parseKanban(SRC);
    const todo = parsed.columns.find((c) => c.name === 'To Do')!;
    const done = parsed.columns.find((c) => c.name === 'Done')!;
    expect(todo.collapsed).toBe(true);
    expect(todo.metadata?.['collapsed']).toBeUndefined();
    expect(done.collapsed).toBeUndefined();
  });

  it('is case-insensitive on the value', () => {
    const parsed = parseKanban('kanban\n[To Do] collapsed: TRUE\n  Task 1');
    expect(parsed.columns.find((c) => c.name === 'To Do')!.collapsed).toBe(
      true
    );
  });

  it('coexists with other column metadata (wip)', () => {
    const parsed = parseKanban(
      'kanban\n[To Do] wip: 3, collapsed: true\n  Task 1'
    );
    const todo = parsed.columns.find((c) => c.name === 'To Do')!;
    expect(todo.collapsed).toBe(true);
    expect(todo.wipLimit).toBe(3);
  });

  it('render() honors the marker — collapsed column hides its card', async () => {
    const collapsed = await render(SRC, { palette: 'slate' });
    const expanded = await render(SRC.replace(' collapsed: true', ''), {
      palette: 'slate',
    });
    expect(expanded.svg).toContain('>Task 1<');
    expect(collapsed.svg).not.toContain('>Task 1<');
    expect(collapsed.svg).toContain('>Task 2<'); // Done stays expanded
  });
});
