import { describe, it, expect, beforeEach } from 'vitest';
import { parseWireframe, resetWireframeIds } from '../src/wireframe/parser';
import { layoutWireframe } from '../src/wireframe/layout';

beforeEach(() => {
  resetWireframeIds();
});

describe('wireframe layout', () => {
  describe('form factor', () => {
    it('desktop width is 1200', () => {
      const parsed = parseWireframe('wireframe Test\n[Main]\n  Text');
      const layout = layoutWireframe(parsed);
      expect(layout.width).toBe(1200);
    });

    it('mobile width is 375', () => {
      const parsed = parseWireframe('wireframe Test\nmobile\n[Main]\n  Text');
      const layout = layoutWireframe(parsed);
      expect(layout.width).toBe(375);
    });
  });

  describe('smart region sizing', () => {
    it('sidebar gets ~25% width', () => {
      const parsed = parseWireframe(
        'wireframe Test\n[Sidebar]\n  Text\n[Main]\n  Text'
      );
      const layout = layoutWireframe(parsed);
      expect(layout.nodes).toHaveLength(2);
      const sidebarNode = layout.nodes.find(
        (n) => n.element.label === 'Sidebar'
      )!;
      const mainNode = layout.nodes.find((n) => n.element.label === 'Main')!;
      // Sidebar ~25% of available width (minus gaps)
      expect(sidebarNode.width).toBeLessThan(mainNode.width);
      expect(sidebarNode.width).toBeGreaterThan(200); // not tiny
    });
  });

  describe('horizontal groups', () => {
    it('horizontal children split equally', () => {
      const parsed = parseWireframe(
        'wireframe Test\n[Row] | horizontal\n  [A]\n    Text\n  [B]\n    Text\n  [C]\n    Text'
      );
      const layout = layoutWireframe(parsed);
      const rowNode = layout.nodes[0];
      expect(rowNode.children).toHaveLength(3);
      // All children should have similar width
      const widths = rowNode.children.map((c) => c.width);
      expect(Math.abs(widths[0] - widths[1])).toBeLessThan(2);
      expect(Math.abs(widths[1] - widths[2])).toBeLessThan(2);
    });
  });

  describe('mobile mode', () => {
    it('all regions stack vertically in mobile', () => {
      const parsed = parseWireframe(
        'wireframe Test\nmobile\n[Sidebar]\n  Text\n[Main]\n  Text'
      );
      const layout = layoutWireframe(parsed);
      // In mobile, regions stack vertically — sidebar y < main y
      const sidebar = layout.nodes.find((n) => n.element.label === 'Sidebar')!;
      const main = layout.nodes.find((n) => n.element.label === 'Main')!;
      expect(sidebar.y).toBeLessThan(main.y);
      // Both should be full width
      expect(sidebar.width).toBe(main.width);
    });
  });

  describe('title height', () => {
    it('includes title height when title present', () => {
      const parsed = parseWireframe('wireframe My Page\nSome text');
      const layout = layoutWireframe(parsed);
      expect(layout.titleHeight).toBe(40);
    });

    it('no title height when no title', () => {
      const parsed = parseWireframe('wireframe\nSome text');
      const layout = layoutWireframe(parsed);
      expect(layout.titleHeight).toBe(0);
    });
  });

  describe('modal layout', () => {
    it('modals positioned below main content', () => {
      const parsed = parseWireframe(
        'wireframe Test\n[Main]\n  Text\nmodal Confirm\n  Are you sure?'
      );
      const layout = layoutWireframe(parsed);
      expect(layout.modalNodes).toHaveLength(1);
      const mainMaxY = Math.max(...layout.nodes.map((n) => n.y + n.height));
      expect(layout.modalNodes[0].y).toBeGreaterThan(mainMaxY);
    });
  });

  describe('collapsed group layout', () => {
    it('collapsed groups are just header height', () => {
      const parsed = parseWireframe(
        'wireframe Test\n[Advanced] | collapsed\n  [Hidden Field]\n  (Hidden Button)'
      );
      const layout = layoutWireframe(parsed);
      const advancedNode = layout.nodes[0];
      // Collapsed = just the group padding top (header area)
      expect(advancedNode.height).toBe(32); // GROUP_PADDING_TOP
      expect(advancedNode.children).toHaveLength(0);
    });
  });
});
