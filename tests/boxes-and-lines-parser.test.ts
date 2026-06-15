import { describe, it, expect } from 'vitest';
import {
  parseBoxesAndLines,
  looksLikeBoxesAndLines,
} from '../src/boxes-and-lines/parser';
import { collapseBoxesAndLines } from '../src/boxes-and-lines/collapse';

describe('boxes-and-lines parser', () => {
  describe('heuristic detection', () => {
    it('always returns false (explicit only)', () => {
      expect(looksLikeBoxesAndLines('API -> DB\nCache -> DB')).toBe(false);
      expect(looksLikeBoxesAndLines('boxes-and-lines Test')).toBe(false);
    });
  });

  describe('first line and title', () => {
    it('parses chart type and title', () => {
      const result = parseBoxesAndLines('boxes-and-lines My System');
      expect(result.type).toBe('boxes-and-lines');
      expect(result.title).toBe('My System');
      expect(result.titleLineNumber).toBe(1);
      expect(result.error).toBeNull();
    });

    it('parses chart type without title', () => {
      const result = parseBoxesAndLines('boxes-and-lines');
      expect(result.type).toBe('boxes-and-lines');
      expect(result.title).toBeNull();
      expect(result.error).toBeNull();
    });

    it('rejects wrong chart type', () => {
      const result = parseBoxesAndLines('sequence Test');
      expect(result.error).toBeTruthy();
    });
  });

  describe('basic nodes', () => {
    it('parses simple node', () => {
      const result = parseBoxesAndLines('boxes-and-lines\nAPI');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].label).toBe('API');
    });

    it('warns on duplicate nodes', () => {
      const result = parseBoxesAndLines('boxes-and-lines\nAPI\nAPI');
      expect(
        result.diagnostics.some((d) => d.message.includes('Duplicate'))
      ).toBe(true);
    });
  });

  describe('implicit node creation', () => {
    it('creates nodes from edge references', () => {
      const result = parseBoxesAndLines('boxes-and-lines\nAPI -> ProductionDB');
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes.find((n) => n.label === 'API')).toBeDefined();
      expect(
        result.nodes.find((n) => n.label === 'ProductionDB')
      ).toBeDefined();
      expect(result.edges).toHaveLength(1);
    });
  });

  describe('pipe metadata', () => {
    it('parses key:value pairs', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nAPI | team: Backend, env: Prod'
      );
      expect(result.nodes[0].metadata.team).toBe('Backend');
      expect(result.nodes[0].metadata.env).toBe('Prod');
    });

    it('extracts description field as string[]', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nAPI | description: Main API gateway'
      );
      expect(result.nodes[0].description).toEqual(['Main API gateway']);
      // description should NOT be in metadata
      expect(result.nodes[0].metadata.description).toBeUndefined();
    });
  });

  describe('edges', () => {
    it('parses plain arrow', () => {
      const result = parseBoxesAndLines('boxes-and-lines\nA -> B');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe('A');
      expect(result.edges[0].target).toBe('B');
      expect(result.edges[0].bidirectional).toBe(false);
    });

    it('parses bidirectional arrow', () => {
      const result = parseBoxesAndLines('boxes-and-lines\nA <-> B');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe('A');
      expect(result.edges[0].target).toBe('B');
      expect(result.edges[0].bidirectional).toBe(true);
    });

    it('parses labeled arrow', () => {
      const result = parseBoxesAndLines('boxes-and-lines\nAPI -queries-> DB');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe('API');
      expect(result.edges[0].target).toBe('DB');
      expect(result.edges[0].label).toBe('queries');
    });

    it('parses bidirectional labeled arrow', () => {
      const result = parseBoxesAndLines('boxes-and-lines\nA <-syncs-> B');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].label).toBe('syncs');
      expect(result.edges[0].bidirectional).toBe(true);
    });

    it('parses edge with pipe metadata', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nA -> B | frequency: High'
      );
      expect(result.edges[0].metadata.frequency).toBe('High');
    });
  });

  describe('indented edges', () => {
    it('uses lastNodeLabel as source', () => {
      const result = parseBoxesAndLines('boxes-and-lines\nAPI\n  -> DB');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe('API');
      expect(result.edges[0].target).toBe('DB');
    });

    it('handles labeled indented edge', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nAPI\n  -reads-> ProductionDB'
      );
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe('API');
      expect(result.edges[0].target).toBe('ProductionDB');
      expect(result.edges[0].label).toBe('reads');
    });

    it('handles indented edge with pipe metadata', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nAPI\n  -reads-> ProductionDB | frequency: High'
      );
      expect(result.edges[0].metadata.frequency).toBe('High');
    });

    it('warns when no preceding node', () => {
      const result = parseBoxesAndLines('boxes-and-lines\n  -> DB');
      expect(
        result.diagnostics.some((d) => d.message.includes('no preceding node'))
      ).toBe(true);
    });

    it('uses containing group as source when inside a group', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\n[AI Only]\n  Boilerplate\n  Log aggregation\n  ->[Human + AI]\n[Human + AI]\n  Code review'
      );
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe('__group_AI Only');
      expect(result.edges[0].target).toBe('__group_Human + AI');
    });
  });

  describe('groups', () => {
    it('parses group with children', () => {
      const result = parseBoxesAndLines('boxes-and-lines\n[AWS]\n  API\n  DB');
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].label).toBe('AWS');
      expect(result.groups[0].children).toContain('API');
      expect(result.groups[0].children).toContain('DB');
    });

    it('parses group with pipe metadata', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\n[AWS] | region: us-east-1\n  API'
      );
      expect(result.groups[0].metadata.region).toBe('us-east-1');
    });

    it('cascades group metadata to children', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\n[AWS] | team: Infra\n  API'
      );
      expect(result.nodes.find((n) => n.label === 'API')?.metadata.team).toBe(
        'Infra'
      );
    });

    it('node metadata overrides group metadata', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\n[AWS] | team: Infra\n  API | team: Backend'
      );
      expect(result.nodes.find((n) => n.label === 'API')?.metadata.team).toBe(
        'Backend'
      );
    });
  });

  describe('nested groups', () => {
    it('parses 2-level nested groups', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\n[AWS]\n  [us-east-1]\n    API\n    DB'
      );
      expect(
        result.diagnostics.some((d) => d.message.includes('maximum depth'))
      ).toBe(false);
      expect(result.groups).toHaveLength(2);

      const inner = result.groups.find((g) => g.label === 'us-east-1');
      expect(inner).toBeDefined();
      expect(inner!.children).toContain('API');
      expect(inner!.children).toContain('DB');
      expect(inner!.parentGroup).toBe('AWS');

      const outer = result.groups.find((g) => g.label === 'AWS');
      expect(outer).toBeDefined();
      expect(outer!.children).toContain('us-east-1');
      expect(outer!.parentGroup).toBeUndefined();
    });

    it('warns on 3-level nesting (exceeds max depth)', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\n[A]\n  [B]\n    [C]\n      X'
      );
      expect(
        result.diagnostics.some((d) => d.message.includes('maximum depth'))
      ).toBe(true);
    });
  });

  describe('group-to-group edges', () => {
    it('parses plain group edge', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\n[Region A]\n  API\n[Region B]\n  DB\n[Region A] -> [Region B]'
      );
      expect(
        result.edges.some(
          (e) =>
            e.source === '__group_Region A' && e.target === '__group_Region B'
        )
      ).toBe(true);
    });

    it('parses bidirectional group edge', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\n[A]\n  N1\n[B]\n  N2\n[A] <-> [B]'
      );
      const edge = result.edges.find((e) => e.source === '__group_A');
      expect(edge?.bidirectional).toBe(true);
    });
  });

  describe('tag declarations', () => {
    it('parses inline tag declaration', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\ntag Team t Backend blue, Frontend green\nAPI | t: Backend'
      );
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Team');
      expect(result.tagGroups[0].alias).toBe('t');
      expect(result.tagGroups[0].entries).toHaveLength(2);
    });

    it('resolves in metadata', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\ntag Team t Backend blue, Frontend green\nAPI | t: Backend'
      );
      expect(result.nodes.find((n) => n.label === 'API')?.metadata.team).toBe(
        'Backend'
      );
    });

    it('validates tag values', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\ntag Team t Backend blue, Frontend green\nAPI | t: Unknown'
      );
      expect(
        result.diagnostics.some((d) => d.message.includes('Unknown'))
      ).toBe(true);
    });

    it('auto-assigns palette colors to bare inline tag values', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\ntag Team t Backend, Frontend\nAPI t: Backend'
      );
      expect(result.tagGroups[0].entries).toHaveLength(2);
      const colors = result.tagGroups[0].entries.map((e) => e.color);
      expect(colors.every((c) => c.startsWith('#') && c !== '')).toBe(true);
      // Two distinct auto colors.
      expect(new Set(colors).size).toBe(2);
    });

    it('bare inline value skips an explicit inline color in the same group', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\ntag Team t Backend, Frontend green\nAPI t: Backend'
      );
      const backend = result.tagGroups[0].entries.find(
        (e) => e.value === 'Backend'
      )!;
      const frontend = result.tagGroups[0].entries.find(
        (e) => e.value === 'Frontend'
      )!;
      expect(frontend.color).toBe('#a3be8c'); // explicit green (Nord)
      expect(backend.color).not.toBe('#a3be8c');
      expect(backend.color).toMatch(/^#/);
    });

    it('uses first entry as default when no default keyword', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\ntag Status s\n  Done green\n  Doing yellow\n  Todo red\nAPI | s: Doing'
      );
      expect(result.tagGroups[0].defaultValue).toBe('Done');
    });

    it('uses entry marked default instead of first entry', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\ntag Status s\n  Done green\n  Doing yellow\n  Todo red\n  NA gray default\nAPI | s: Doing'
      );
      expect(result.tagGroups[0].defaultValue).toBe('NA');
      expect(result.tagGroups[0].entries).toHaveLength(4);
      // NA should not have "default" in its value
      expect(result.tagGroups[0].entries[3].value).toBe('NA');
    });

    it('supports default keyword in inline tag declaration', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\ntag Status s Done green, NA gray default\nAPI'
      );
      expect(result.tagGroups[0].defaultValue).toBe('NA');
    });

    it('injects default tag value into untagged nodes', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\ntag Status s\n  Done green\n  NA gray default\nAPI\nDB | s: Done'
      );
      // API has no s: metadata — should get the default (NA)
      const api = result.nodes.find((n) => n.label === 'API');
      expect(api?.metadata.status).toBe('NA');
      // DB has explicit value — should keep it
      const db = result.nodes.find((n) => n.label === 'DB');
      expect(db?.metadata.status).toBe('Done');
    });

    it('rejects tags after content', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nAPI\ntag Team t Backend blue'
      );
      expect(
        result.diagnostics.some((d) =>
          d.message.includes('before diagram content')
        )
      ).toBe(true);
    });
  });

  describe('directives', () => {
    it('parses direction TB', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\ndirection TB\nA -> B'
      );
      expect(result.direction).toBe('TB');
    });

    it('defaults to LR', () => {
      const result = parseBoxesAndLines('boxes-and-lines\nA -> B');
      expect(result.direction).toBe('LR');
    });

    it('parses active-tag', () => {
      const result = parseBoxesAndLines('boxes-and-lines\nactive-tag Team\nA');
      expect(result.options['active-tag']).toBe('Team');
    });

    it('parses hide directive', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nhide team:Backend\nA'
      );
      expect(result.initialHiddenTagValues.get('team')?.has('backend')).toBe(
        true
      );
    });
  });

  describe('edge cases', () => {
    it('handles empty input', () => {
      const result = parseBoxesAndLines('');
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it('handles only chart type line', () => {
      const result = parseBoxesAndLines('boxes-and-lines Test');
      expect(result.nodes).toHaveLength(0);
      expect(result.error).toBeNull();
    });

    it('handles comments', () => {
      const result = parseBoxesAndLines('boxes-and-lines\n// comment\nAPI');
      expect(result.nodes).toHaveLength(1);
    });

    it('handles blank lines', () => {
      const result = parseBoxesAndLines('boxes-and-lines\n\nAPI\n\nDB');
      expect(result.nodes).toHaveLength(2);
    });

    it('handles nodes with no edges', () => {
      const result = parseBoxesAndLines('boxes-and-lines\nA\nB\nC');
      expect(result.nodes).toHaveLength(3);
      expect(result.edges).toHaveLength(0);
    });

    it('handles edge with missing target', () => {
      const result = parseBoxesAndLines('boxes-and-lines\nA ->');
      expect(
        result.diagnostics.some((d) => d.message.includes('missing'))
      ).toBe(true);
    });
  });

  describe('indented group-targeted arrows', () => {
    it('node -> [group]: indented arrow targets group', () => {
      const content = [
        'boxes-and-lines',
        '[Backend]',
        '  DB',
        'API',
        '  -> [Backend]',
      ].join('\n');
      const result = parseBoxesAndLines(content);
      expect(
        result.edges.some(
          (e) => e.source === 'API' && e.target === '__group_Backend'
        )
      ).toBe(true);
    });

    it('[group] -> node: indented arrow directly under group targets node', () => {
      const content = [
        'boxes-and-lines',
        '[Backend]',
        '  -> API',
        '  DB',
        'API',
      ].join('\n');
      const result = parseBoxesAndLines(content);
      expect(
        result.edges.some(
          (e) => e.source === '__group_Backend' && e.target === 'API'
        )
      ).toBe(true);
    });

    it('[group] -> [group]: indented arrow directly under group to group', () => {
      const content = [
        'boxes-and-lines',
        '[Backend]',
        '  -> [Frontend]',
        '  DB',
        '[Frontend]',
        '  UI',
      ].join('\n');
      const result = parseBoxesAndLines(content);
      expect(
        result.edges.some(
          (e) =>
            e.source === '__group_Backend' && e.target === '__group_Frontend'
        )
      ).toBe(true);
    });

    it('labeled indented arrow: -data-> [Group]', () => {
      const content = [
        'boxes-and-lines',
        'API',
        '  -data-> [Backend]',
        '[Backend]',
        '  DB',
      ].join('\n');
      const result = parseBoxesAndLines(content);
      const edge = result.edges.find((e) => e.target === '__group_Backend');
      expect(edge).toBeDefined();
      expect(edge!.label).toBe('data');
      expect(edge!.source).toBe('API');
    });

    it('error: -> [Nonexistent] produces group-specific error', () => {
      const content = ['boxes-and-lines', 'API', '  -> [Nonexistent]'].join(
        '\n'
      );
      const result = parseBoxesAndLines(content);
      expect(
        result.diagnostics.some((d) =>
          d.message.includes("Group '[Nonexistent]' not found")
        )
      ).toBe(true);
      // No phantom node created
      expect(result.nodes.every((n) => !n.label.includes('Nonexistent'))).toBe(
        true
      );
    });

    it('no implicit node created for [Group] targets', () => {
      const content = [
        'boxes-and-lines',
        '[Backend]',
        '  DB',
        'API',
        '  -> [Backend]',
      ].join('\n');
      const result = parseBoxesAndLines(content);
      // Should not have a node named "[Backend]" or "Backend" (only DB and API)
      expect(result.nodes.map((n) => n.label).sort()).toEqual(['API', 'DB']);
    });

    it('top-level node -> [Group] via full syntax', () => {
      const content = [
        'boxes-and-lines',
        '[Backend]',
        '  DB',
        'API -> [Backend]',
      ].join('\n');
      const result = parseBoxesAndLines(content);
      expect(
        result.edges.some(
          (e) => e.source === 'API' && e.target === '__group_Backend'
        )
      ).toBe(true);
    });
  });

  describe('node descriptions', () => {
    it('collects indented lines as description', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nStage 1\n  Tools in use\n  Primary build'
      );
      expect(result.nodes[0].description).toEqual([
        'Tools in use',
        'Primary build',
      ]);
    });

    it('excludes edge lines from description', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nStage 1\n  Tools in use\n  -> Stage 2'
      );
      expect(result.nodes[0].description).toEqual(['Tools in use']);
      expect(result.edges).toHaveLength(1);
    });

    it('merges pipe description with indented lines', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nStage 1 | description: Summary\n  More detail'
      );
      expect(result.nodes[0].description).toEqual(['Summary', 'More detail']);
    });

    it('description-only block (no edges)', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nStage 1\n  Line one\n  Line two'
      );
      expect(result.nodes[0].description).toEqual(['Line one', 'Line two']);
      expect(result.edges).toHaveLength(0);
    });

    it('edge-only block (no description)', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nStage 1\n  -> Stage 2\n  -> Stage 3'
      );
      expect(result.nodes[0].description).toBeUndefined();
      expect(result.edges).toHaveLength(2);
    });

    it('warns on text after edges', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nStage 1\n  -> Stage 2\n  Late text'
      );
      expect(
        result.diagnostics.some((d) =>
          d.message.includes('Move description lines above edges')
        )
      ).toBe(true);
    });

    it('skips blank lines within description block', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nStage 1\n  Line one\n\n  Line two'
      );
      expect(result.nodes[0].description).toEqual(['Line one', 'Line two']);
    });

    it('hints on malformed edge lines', () => {
      const result = parseBoxesAndLines('boxes-and-lines\nStage 1\n  -Target');
      expect(
        result.diagnostics.some((d) => d.message.includes('incomplete edge'))
      ).toBe(true);
    });

    it('does not warn on dash-space list items in descriptions', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nStage 1\n  - important note'
      );
      expect(
        result.diagnostics.some((d) => d.message.includes('incomplete edge'))
      ).toBe(false);
      expect(result.nodes[0].description).toEqual(['- important note']);
    });

    it('description inside group at double-indent', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\n[Backend]\n  API\n    Handles requests\n    -> DB'
      );
      const api = result.nodes.find((n) => n.label === 'API');
      expect(api?.description).toEqual(['Handles requests']);
      expect(result.edges).toHaveLength(1);
    });

    it('description inside nested group at triple-indent', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\n[AWS]\n  [Compute]\n    API\n      Handles requests'
      );
      const api = result.nodes.find((n) => n.label === 'API');
      expect(api?.description).toEqual(['Handles requests']);
    });

    it('multiple nodes with descriptions', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nNode A\n  Desc A\nNode B\n  Desc B'
      );
      const a = result.nodes.find((n) => n.label === 'Node A');
      const b = result.nodes.find((n) => n.label === 'Node B');
      expect(a?.description).toEqual(['Desc A']);
      expect(b?.description).toEqual(['Desc B']);
    });

    it('pipe-only description (no indented lines) still works', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nAPI | description: Main gateway'
      );
      expect(result.nodes[0].description).toEqual(['Main gateway']);
    });
  });

  describe('collapse with group-targeted edges', () => {
    it('node outside group -> [Group], group collapsed: edge routes to collapsed group', () => {
      const content = [
        'boxes-and-lines',
        'API',
        '  -> [Backend]',
        '[Backend]',
        '  DB',
        '  Cache',
      ].join('\n');
      const parsed = parseBoxesAndLines(content);
      const { parsed: result } = collapseBoxesAndLines(
        parsed,
        new Set(['Backend'])
      );
      // Edge target is already __group_Backend, so it stays the same after collapse
      expect(
        result.edges.some(
          (e) => e.source === 'API' && e.target === '__group_Backend'
        )
      ).toBe(true);
    });

    it('node inside collapsed group -> [OtherGroup]: source reroutes to own group', () => {
      const content = [
        'boxes-and-lines',
        '[Frontend]',
        '  UI',
        '  UI -> [Backend]',
        '[Backend]',
        '  DB',
      ].join('\n');
      const parsed = parseBoxesAndLines(content);
      const { parsed: result } = collapseBoxesAndLines(
        parsed,
        new Set(['Frontend'])
      );
      // UI reroutes to __group_Frontend; target stays __group_Backend
      expect(
        result.edges.some(
          (e) =>
            e.source === '__group_Frontend' && e.target === '__group_Backend'
        )
      ).toBe(true);
    });
  });

  describe('value metric + box-metric directive', () => {
    it('lifts `value: X` into a numeric node.value, not metadata (AC1)', () => {
      const r = parseBoxesAndLines('boxes-and-lines\nAPI value: 4200');
      const node = r.nodes.find((n) => n.label === 'API')!;
      expect(node.value).toBe(4200);
      expect(node.metadata['value']).toBeUndefined();
    });

    it('parses value with no space and never as a tag value (AC2, AC24)', () => {
      const r = parseBoxesAndLines('boxes-and-lines\nAPI value:4200');
      const node = r.nodes.find((n) => n.label === 'API')!;
      expect(node.value).toBe(4200);
      expect(node.metadata['value']).toBeUndefined();
    });

    it('parses a box literally labeled "Value" without lifting (AC2)', () => {
      const r = parseBoxesAndLines('boxes-and-lines\nValue');
      const node = r.nodes.find((n) => n.label === 'Value')!;
      expect(node.value).toBeUndefined();
    });

    it('does not lift `value:` appearing in a description line (AC2)', () => {
      const r = parseBoxesAndLines(
        'boxes-and-lines\nAPI\n  has a value: high throughput'
      );
      const node = r.nodes.find((n) => n.label === 'API')!;
      expect(node.value).toBeUndefined();
      expect(node.description?.join(' ')).toContain('value: high throughput');
    });

    it('errors on a non-numeric value and leaves node.value undefined (AC3)', () => {
      const r = parseBoxesAndLines('boxes-and-lines\nAPI value: high');
      const node = r.nodes.find((n) => n.label === 'API')!;
      expect(node.value).toBeUndefined();
      expect(
        r.diagnostics.some(
          (d) =>
            d.severity === 'error' &&
            d.message === 'value must be a number (got "high")'
        )
      ).toBe(true);
    });

    it('keeps a value: 0 box (0 is a real value, AC22)', () => {
      const r = parseBoxesAndLines('boxes-and-lines\nDB value: 0');
      const node = r.nodes.find((n) => n.label === 'DB')!;
      expect(node.value).toBe(0);
    });

    it('parses negative values (AC12)', () => {
      const r = parseBoxesAndLines('boxes-and-lines\nA value: -5');
      expect(r.nodes.find((n) => n.label === 'A')!.value).toBe(-5);
    });

    it('parses `box-metric Label color` into typed fields (AC4)', () => {
      const r = parseBoxesAndLines(
        'boxes-and-lines\nbox-metric Headcount red\nAPI value: 12'
      );
      expect(r.boxMetric).toBe('Headcount');
      expect(r.boxMetricColor).toBe('red');
    });

    it('parses `box-metric` with no trailing color', () => {
      const r = parseBoxesAndLines(
        'boxes-and-lines\nbox-metric Cost\nAPI value: 12'
      );
      expect(r.boxMetric).toBe('Cost');
      expect(r.boxMetricColor).toBeUndefined();
      expect(r.boxMetricLowColor).toBeUndefined();
    });

    it('parses two trailing colors into low (first) + high (second) — AC1', () => {
      const r = parseBoxesAndLines(
        'boxes-and-lines\nbox-metric Revenue blue green\nAPI value: 12'
      );
      expect(r.boxMetric).toBe('Revenue');
      expect(r.boxMetricLowColor).toBe('blue');
      expect(r.boxMetricColor).toBe('green');
    });

    it('respects color order — no sorting (AC4)', () => {
      const r = parseBoxesAndLines(
        'boxes-and-lines\nbox-metric Risk red green\nAPI value: 1'
      );
      expect(r.boxMetricLowColor).toBe('red');
      expect(r.boxMetricColor).toBe('green');
    });

    it('does not empty a color-word label (AC5)', () => {
      const r = parseBoxesAndLines(
        'boxes-and-lines\nbox-metric Red blue\nAPI value: 1'
      );
      expect(r.boxMetric).toBe('Red');
      expect(r.boxMetricColor).toBe('blue');
      expect(r.boxMetricLowColor).toBeUndefined();
    });

    it('parses `show-values` flag (off by default)', () => {
      expect(parseBoxesAndLines('boxes-and-lines\nA value: 1').showValues).toBe(
        undefined
      );
      const r = parseBoxesAndLines('boxes-and-lines\nshow-values\nA value: 1');
      expect(r.showValues).toBe(true);
    });

    it('accepts `active-tag <metric>` with no warning (AC7)', () => {
      const r = parseBoxesAndLines(
        'boxes-and-lines\nbox-metric Headcount\nactive-tag Headcount\nAPI value: 12'
      );
      expect(r.options['active-tag']).toBe('Headcount');
      expect(r.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(
        0
      );
    });

    it('ignores box-metric declared after content (pre-content only, AC20)', () => {
      const r = parseBoxesAndLines(
        'boxes-and-lines\nAPI value: 12\nbox-metric Headcount'
      );
      expect(r.boxMetric).toBeUndefined();
    });
  });
});
