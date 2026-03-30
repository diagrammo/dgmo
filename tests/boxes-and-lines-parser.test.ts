import { describe, it, expect } from 'vitest';
import {
  parseBoxesAndLines,
  looksLikeBoxesAndLines,
} from '../src/boxes-and-lines/parser';

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
      expect(result.nodes[0].shape).toBe('service');
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
      expect(result.nodes.find((n) => n.label === 'API')?.shape).toBe(
        'service'
      );
      expect(result.nodes.find((n) => n.label === 'ProductionDB')?.shape).toBe(
        'database'
      );
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

    it('extracts description field', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nAPI | description: Main API gateway'
      );
      expect(result.nodes[0].description).toBe('Main API gateway');
      // description should NOT be in metadata
      expect(result.nodes[0].metadata.description).toBeUndefined();
    });
  });

  describe('explicit type override', () => {
    it('parses [type] override', () => {
      const result = parseBoxesAndLines('boxes-and-lines\nMyNode [database]');
      expect(result.nodes[0].label).toBe('MyNode');
      expect(result.nodes[0].shapeOverride).toBe('database');
    });

    it('preserves inferred shape alongside override', () => {
      const result = parseBoxesAndLines('boxes-and-lines\nMyNode [database]');
      // shape is inferred, shapeOverride is explicit
      expect(result.nodes[0].shape).toBeDefined();
      expect(result.nodes[0].shapeOverride).toBe('database');
    });

    it('ignores invalid type', () => {
      const result = parseBoxesAndLines('boxes-and-lines\nMyNode [foobar]');
      expect(result.nodes[0].shapeOverride).toBeUndefined();
    });

    it('parses type override with pipe metadata', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nAPI [database] | team: Backend'
      );
      expect(result.nodes[0].label).toBe('API');
      expect(result.nodes[0].shapeOverride).toBe('database');
      expect(result.nodes[0].metadata.team).toBe('Backend');
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
    it('parses 2-level nesting', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\n[AWS]\n  [us-east-1]\n    API\n    DB'
      );
      expect(result.groups).toHaveLength(2);
      const inner = result.groups.find((g) => g.label === 'us-east-1');
      const outer = result.groups.find((g) => g.label === 'AWS');
      expect(inner?.parentGroup).toBe('AWS');
      expect(inner?.children).toContain('API');
      expect(inner?.children).toContain('DB');
      // Outer group should have inner group ID as child
      expect(outer?.children).toContain('__group_us-east-1');
    });

    it('warns on 3-level nesting', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\n[A]\n  [B]\n    [C]\n      Node'
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
        'boxes-and-lines\ntag Team t Backend(blue), Frontend(green)\nAPI | t: Backend'
      );
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Team');
      expect(result.tagGroups[0].alias).toBe('t');
      expect(result.tagGroups[0].entries).toHaveLength(2);
    });

    it('resolves alias in metadata', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\ntag Team t Backend(blue), Frontend(green)\nAPI | t: Backend'
      );
      expect(result.nodes.find((n) => n.label === 'API')?.metadata.team).toBe(
        'Backend'
      );
    });

    it('validates tag values', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\ntag Team t Backend(blue), Frontend(green)\nAPI | t: Unknown'
      );
      expect(
        result.diagnostics.some((d) => d.message.includes('Unknown'))
      ).toBe(true);
    });

    it('rejects tags after content', () => {
      const result = parseBoxesAndLines(
        'boxes-and-lines\nAPI\ntag Team t Backend(blue)'
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

    it('parses mode shapes', () => {
      const result = parseBoxesAndLines('boxes-and-lines\nmode shapes\nA -> B');
      expect(result.renderMode).toBe('shapes');
    });

    it('defaults to rectangles', () => {
      const result = parseBoxesAndLines('boxes-and-lines\nA -> B');
      expect(result.renderMode).toBe('rectangles');
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
});
