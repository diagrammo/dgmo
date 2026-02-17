import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  GraphShape,
  GraphDirection,
  GraphNode,
  GraphEdge,
  GraphGroup,
  ParsedGraph,
} from '../src/graph/types';

describe('graph types', () => {
  describe('GraphShape', () => {
    it('accepts all 6 flowchart shape values', () => {
      const shapes: GraphShape[] = [
        'terminal',
        'process',
        'decision',
        'io',
        'subroutine',
        'document',
      ];
      expectTypeOf(shapes).toEqualTypeOf<GraphShape[]>();
    });

    it('rejects invalid strings', () => {
      // @ts-expect-error — 'rectangle' is not a valid GraphShape
      const invalid: GraphShape = 'rectangle';
      void invalid;
    });
  });

  describe('GraphDirection', () => {
    it('accepts TB and LR', () => {
      const tb: GraphDirection = 'TB';
      const lr: GraphDirection = 'LR';
      expectTypeOf(tb).toEqualTypeOf<GraphDirection>();
      expectTypeOf(lr).toEqualTypeOf<GraphDirection>();
    });

    it('rejects invalid direction', () => {
      // @ts-expect-error — 'BT' is not a valid GraphDirection
      const invalid: GraphDirection = 'BT';
      void invalid;
    });
  });

  describe('GraphNode', () => {
    it('requires id, label, shape, lineNumber', () => {
      const node: GraphNode = {
        id: 'n1',
        label: 'Start',
        shape: 'terminal',
        lineNumber: 1,
      };
      expectTypeOf(node).toMatchTypeOf<GraphNode>();
    });

    it('accepts optional color and group', () => {
      const node: GraphNode = {
        id: 'n2',
        label: 'Process',
        shape: 'process',
        color: '#ff0000',
        group: 'g1',
        lineNumber: 2,
      };
      expectTypeOf(node).toMatchTypeOf<GraphNode>();
    });

    it('allows omitting optional fields', () => {
      const node: GraphNode = {
        id: 'n3',
        label: 'Check',
        shape: 'decision',
        lineNumber: 3,
      };
      expectTypeOf(node.color).toEqualTypeOf<string | undefined>();
      expectTypeOf(node.group).toEqualTypeOf<string | undefined>();
    });
  });

  describe('GraphEdge', () => {
    it('requires source, target, lineNumber', () => {
      const edge: GraphEdge = {
        source: 'n1',
        target: 'n2',
        lineNumber: 4,
      };
      expectTypeOf(edge).toMatchTypeOf<GraphEdge>();
    });

    it('accepts optional label and color', () => {
      const edge: GraphEdge = {
        source: 'n1',
        target: 'n2',
        label: 'yes',
        color: 'green',
        lineNumber: 5,
      };
      expectTypeOf(edge).toMatchTypeOf<GraphEdge>();
    });

    it('allows omitting optional fields', () => {
      const edge: GraphEdge = {
        source: 'n1',
        target: 'n2',
        lineNumber: 6,
      };
      expectTypeOf(edge.label).toEqualTypeOf<string | undefined>();
      expectTypeOf(edge.color).toEqualTypeOf<string | undefined>();
    });
  });

  describe('GraphGroup', () => {
    it('requires id, label, nodeIds, lineNumber', () => {
      const group: GraphGroup = {
        id: 'g1',
        label: 'API Gateway',
        nodeIds: ['n1', 'n2'],
        lineNumber: 7,
      };
      expectTypeOf(group).toMatchTypeOf<GraphGroup>();
    });

    it('accepts optional color', () => {
      const group: GraphGroup = {
        id: 'g2',
        label: 'Service',
        color: 'blue',
        nodeIds: ['n3'],
        lineNumber: 8,
      };
      expectTypeOf(group).toMatchTypeOf<GraphGroup>();
    });

    it('allows omitting optional fields', () => {
      const group: GraphGroup = {
        id: 'g3',
        label: 'Test',
        nodeIds: [],
        lineNumber: 9,
      };
      expectTypeOf(group.color).toEqualTypeOf<string | undefined>();
    });
  });

  describe('ParsedGraph', () => {
    it('requires type, direction, nodes, edges', () => {
      const graph: ParsedGraph = {
        type: 'flowchart',
        direction: 'TB',
        nodes: [],
        edges: [],
      };
      expectTypeOf(graph).toMatchTypeOf<ParsedGraph>();
    });

    it('accepts optional title, groups, error', () => {
      const graph: ParsedGraph = {
        type: 'flowchart',
        direction: 'LR',
        nodes: [
          { id: 'n1', label: 'Start', shape: 'terminal', lineNumber: 1 },
        ],
        edges: [{ source: 'n1', target: 'n2', lineNumber: 2 }],
        title: 'My Flow',
        groups: [
          { id: 'g1', label: 'Group', nodeIds: ['n1'], lineNumber: 3 },
        ],
        error: 'some error',
      };
      expectTypeOf(graph).toMatchTypeOf<ParsedGraph>();
    });

    it('allows omitting optional fields', () => {
      const graph: ParsedGraph = {
        type: 'flowchart',
        direction: 'TB',
        nodes: [],
        edges: [],
      };
      expectTypeOf(graph.title).toEqualTypeOf<string | undefined>();
      expectTypeOf(graph.groups).toEqualTypeOf<GraphGroup[] | undefined>();
      expectTypeOf(graph.error).toEqualTypeOf<string | undefined>();
    });

    it('can represent all 6 shape types', () => {
      const graph: ParsedGraph = {
        type: 'flowchart',
        direction: 'TB',
        nodes: [
          { id: 'n1', label: 'Start', shape: 'terminal', lineNumber: 1 },
          { id: 'n2', label: 'Step', shape: 'process', lineNumber: 2 },
          { id: 'n3', label: 'Check?', shape: 'decision', lineNumber: 3 },
          { id: 'n4', label: 'Input', shape: 'io', lineNumber: 4 },
          { id: 'n5', label: 'Sub', shape: 'subroutine', lineNumber: 5 },
          { id: 'n6', label: 'Report', shape: 'document', lineNumber: 6 },
        ],
        edges: [
          { source: 'n1', target: 'n2', lineNumber: 7 },
          { source: 'n2', target: 'n3', label: 'check', lineNumber: 8 },
          {
            source: 'n3',
            target: 'n4',
            label: 'yes',
            color: 'green',
            lineNumber: 9,
          },
        ],
        groups: [
          {
            id: 'g1',
            label: 'Main',
            color: 'blue',
            nodeIds: ['n1', 'n2', 'n3'],
            lineNumber: 10,
          },
        ],
      };
      expect(graph.nodes).toHaveLength(6);
      expect(graph.edges).toHaveLength(3);
    });
  });
});
