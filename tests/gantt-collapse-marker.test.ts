import { describe, expect, it } from 'vitest';

import { calculateSchedule } from '../src/gantt/calculator';
import { parseGantt } from '../src/gantt/parser';
import { getPalette } from '../src/palettes';
import { render } from '../src/render';
import type { GanttGroup, GanttNode } from '../src/gantt/types';

const palette = getPalette('slate').light;

const SRC = `gantt
[Backend] collapsed: true
  API duration: 5d
[Frontend]
  UI duration: 3d`;

function groupsOf(nodes: readonly GanttNode[]): GanttGroup[] {
  const out: GanttGroup[] = [];
  for (const n of nodes) {
    if (n.kind === 'group') {
      out.push(n);
      out.push(...groupsOf(n.children));
    } else if (n.kind === 'parallel') {
      out.push(...groupsOf(n.children));
    }
  }
  return out;
}

describe('gantt `[Group] collapsed: true` marker', () => {
  it('parses the marker into a typed group field, not metadata', () => {
    const parsed = parseGantt(SRC, palette);
    const groups = groupsOf(parsed.nodes);
    const backend = groups.find((g) => g.name === 'Backend')!;
    const frontend = groups.find((g) => g.name === 'Frontend')!;
    expect(backend.collapsed).toBe(true);
    expect(backend.metadata['collapsed']).toBeUndefined();
    expect(frontend.collapsed).toBeUndefined();
  });

  it('propagates collapsed onto the resolved group', () => {
    const resolved = calculateSchedule(parseGantt(SRC, palette));
    const backend = resolved.groups.find((g) => g.name === 'Backend')!;
    const frontend = resolved.groups.find((g) => g.name === 'Frontend')!;
    expect(backend.collapsed).toBe(true);
    expect(frontend.collapsed).toBeUndefined();
  });

  it('is case-insensitive on the value', () => {
    const parsed = parseGantt(
      'gantt\n[Backend] collapsed: TRUE\n  API duration: 5d',
      palette
    );
    const backend = groupsOf(parsed.nodes).find((g) => g.name === 'Backend')!;
    expect(backend.collapsed).toBe(true);
  });

  it('render() honors the source marker — collapsed child rows are hidden', async () => {
    const collapsed = await render(SRC, { palette: 'slate' });
    const expanded = await render(SRC.replace(' collapsed: true', ''), {
      palette: 'slate',
    });
    // The Backend group is still shown; its child task label is hidden when
    // collapsed but present when expanded.
    expect(expanded.svg).toContain('>API<');
    expect(collapsed.svg).not.toContain('>API<');
    expect(collapsed.svg).toContain('>UI<'); // Frontend stays expanded
  });
});
