import { describe, it, expect } from 'vitest';
import { parseBlock } from '../src/block/parser';
import { layoutBlock } from '../src/block/layout';
import { tagAttrKey } from '../src/utils/tag-groups';
import { isBlockNode, type BlockGrid, type BlockNode } from '../src/block/types';

function codes(r: ReturnType<typeof parseBlock>): string[] {
  return r.diagnostics.map((d) => d.code ?? '').filter(Boolean);
}

function allNodes(grid: BlockGrid): BlockNode[] {
  const out: BlockNode[] = [];
  for (const row of grid.rows)
    for (const c of row)
      if (isBlockNode(c)) {
        out.push(c);
        if (c.grid) out.push(...allNodes(c.grid));
      }
  return out;
}

function find(grid: BlockGrid, label: string): BlockNode | undefined {
  return allNodes(grid).find((n) => n.label === label);
}

describe('parseBlock — declaration & rows', () => {
  it('parses the title and a row of blocks', () => {
    const r = parseBlock('block System\n\n[Web] [Mobile] [CLI]');
    expect(r.error).toBeNull();
    expect(r.title).toBe('System');
    expect(r.top.rows).toHaveLength(1);
    expect(r.top.rows[0]).toHaveLength(3);
    expect(find(r.top, 'Mobile')).toBeDefined();
  });

  it('allows a missing title', () => {
    const r = parseBlock('block\n[A] [B]');
    expect(r.error).toBeNull();
    expect(r.title).toBeNull();
  });

  it('rejects the wrong chart type', () => {
    const r = parseBlock('treemap A 1\nB 2');
    expect(r.error).not.toBeNull();
  });

  it('errors on empty content', () => {
    expect(parseBlock('').error).not.toBeNull();
    expect(parseBlock('block').error).not.toBeNull();
  });
});

describe('parseBlock — columns inference', () => {
  it('infers columns from the widest row and fills a lone block', () => {
    const r = parseBlock('block T\n\n[Web] [Mobile] [CLI]\n[API Gateway]\n[A] [B] [C]');
    expect(r.top.cols).toBe(3);
    // A lone block on its row even-fills to the full width.
    expect(find(r.top, 'API Gateway')!.span).toBe(3);
  });

  it('honours an explicit columns directive', () => {
    const r = parseBlock('block T\ncolumns 6\n\n[Half] [Half2]');
    expect(r.top.cols).toBe(6);
    // 6 / 2 = 3 → each even-fills to span 3.
    expect(r.top.rows[0]![0]!.span).toBe(3);
  });

  it('accepts a top-level columns directive before the tag block', () => {
    const r = parseBlock(
      'block Stack\ncolumns 6\n\ntag Tier as t\n  Logic green\n\n[Logic] t: Logic\n  [Auth] [Orders]'
    );
    expect(r.error).toBeNull();
    expect(r.top.cols).toBe(6);
    expect(r.tagGroups).toHaveLength(1);
  });

  it('clamps a span larger than the column count', () => {
    const r = parseBlock('block T\ncolumns 3\n\n[Banner] span: 9\n[A] [B] [C]');
    expect(find(r.top, 'Banner')!.span).toBe(3);
  });
});

describe('parseBlock — containers', () => {
  it('nests an indented sub-grid into a container', () => {
    const r = parseBlock('block T\n\n[Backend]\n  [Auth] [Orders]\n  [Inventory] [Billing]');
    const backend = find(r.top, 'Backend')!;
    expect(backend.grid).toBeDefined();
    expect(backend.grid!.rows).toHaveLength(2);
    expect(find(r.top, 'Auth')).toBeDefined();
  });

  it('seeds the collapsed flag from the bare token', () => {
    const r = parseBlock('block T\n\n[Data] collapsed\n  [Postgres] [Redis]');
    expect(find(r.top, 'Data')!.collapsed).toBe(true);
  });
});

describe('parseBlock — tags outside the bracket', () => {
  it('cascades a group tag to children and lets a leaf override', () => {
    const r = parseBlock(
      'block Mesh\n\ntag Status as s\n  Healthy green\n  Down red\n\n[Services] s: Healthy\n  [Auth] [Billing] s: Down'
    );
    expect(r.error).toBeNull();
    const key = tagAttrKey('Status');
    expect(find(r.top, 'Services')!.metadata[key]).toBe('Healthy');
    // Auth has no own tag → inherits the group's.
    expect(find(r.top, 'Auth')!.metadata[key]).toBe('Healthy');
    // Billing overrides.
    expect(find(r.top, 'Billing')!.metadata[key]).toBe('Down');
  });

  it('keeps a colon inside the label as label text, tag stays outside', () => {
    const r = parseBlock('block T\n\ntag State as s\n  Down red\n\n[API: v2] s: Down');
    const node = find(r.top, 'API: v2');
    expect(node).toBeDefined();
    expect(node!.metadata[tagAttrKey('State')]).toBe('Down');
  });
});

describe('parseBlock — empty cells & layout', () => {
  it('parses an underscore as a deliberate empty cell', () => {
    const r = parseBlock('block T\ncolumns 4\n\n[Header] span: 2 _ [Flags]');
    const row = r.top.rows[0]!;
    expect(row.some((c) => !isBlockNode(c))).toBe(true);
    expect(find(r.top, 'Header')!.span).toBe(2);
  });

  it('lays out a nested diagram without crushing inner blocks', () => {
    const r = parseBlock('block T\n\n[VPC]\n  [Public] [Private]\n  [Data]');
    const layout = layoutBlock(r.top, {});
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    // No item should be narrower than the minimum column width floor.
    const widths: number[] = [];
    const walk = (items: typeof layout.items): void => {
      for (const it of items) {
        if (it.type !== 'empty') widths.push(it.w);
        if (it.inner) walk(it.inner);
      }
    };
    walk(layout.items);
    expect(Math.min(...widths)).toBeGreaterThan(60);
  });

  it('renders a collapsed container as a compact band in the layout', () => {
    const r = parseBlock('block T\n\n[Data] collapsed\n  [A] [B] [C]');
    const layout = layoutBlock(r.top, {
      collapsed: new Set(find(r.top, 'Data')!.id ? [find(r.top, 'Data')!.id] : []),
    });
    const collapsed = layout.items.find((it) => it.type === 'collapsed');
    expect(collapsed).toBeDefined();
  });
});

describe('parseBlock — diagnostics', () => {
  it('flags a tag group declared after content', () => {
    const r = parseBlock('block T\n\n[A]\n\ntag Late as l\n  X red');
    expect(codes(r)).toContain('E_TAG_DECLARED_AFTER_CONTENT');
  });
});
