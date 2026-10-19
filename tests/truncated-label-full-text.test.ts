import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { renderBoxesAndLines } from '../src/boxes-and-lines/renderer';
import { renderMindmapForExport } from '../src/mindmap/renderer';
import { parseInfra } from '../src/infra/parser';
import { computeInfra } from '../src/infra/compute';
import { layoutInfra } from '../src/infra/layout';
import { renderInfra } from '../src/infra/renderer';
import { getPalette } from '../src/palettes';
import { normalizeName } from '../src/utils/name-normalize';

// A truncated label or description carries its full text on the node's
// [data-line-number] element (#1059), so the app's preview navigation can read
// it without guessing which drawn lines it stands for. No tabindex is added.

const P = getPalette('nord').light;
const LONG =
  'This description runs on far past anything the box can show so the renderer has to cut it short with an ellipsis somewhere well before the end of the sentence which keeps going for quite a while longer still';

function parseSvg(html: string): SVGSVGElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.querySelector('svg')!;
}

async function renderBL(src: string): Promise<SVGSVGElement> {
  const parsed = parseBoxesAndLines(src);
  const layout = await layoutBoxesAndLines(parsed);
  const el = document.createElement('div');
  renderBoxesAndLines(el, parsed, layout, P, false, {
    exportDims: { width: 800, height: 600 },
  });
  return el.querySelector('svg')!;
}

function renderInfraSvg(src: string, expandedId: string): SVGSVGElement {
  const parsed = parseInfra(src);
  expect(parsed.error).toBeNull();
  const computed = computeInfra(parsed);
  const expanded = new Set([normalizeName(expandedId)]);
  const layout = layoutInfra(computed, expanded);
  const el = document.createElement('div');
  renderInfra(
    el,
    layout,
    P,
    false,
    parsed.title,
    parsed.titleLineNumber,
    parsed.tagGroups,
    null,
    false,
    null,
    expanded
  );
  return el.querySelector('svg')!;
}

describe('full text of a truncated node (#1059)', () => {
  describe('boxes-and-lines', () => {
    it('puts the full label and description on a node whose description is cut', async () => {
      const lines = Array.from(
        { length: 12 },
        (_, i) => `  line ${i + 1} ${LONG}`
      );
      const svg = await renderBL(
        `boxes-and-lines\nA\n${lines.join('\n')}\nB\nA -> B`
      );
      const a = svg.querySelector('.bl-node[data-node-id="A"]')!;
      expect(a.getAttribute('data-line-number')).not.toBeNull();
      const full = a.getAttribute('data-full-text');
      expect(full).not.toBeNull();
      expect(full!.split('\n')).toEqual(['A', ...lines.map((l) => l.trim())]);
      expect(a.hasAttribute('tabindex')).toBe(false);
    });

    it('puts the full label on a node whose label is cut', async () => {
      const label = 'Supercalifragilisticexpialidociousnessmonstrosityservice';
      const svg = await renderBL(`boxes-and-lines\n${label}\nB\n${label} -> B`);
      const node = svg.querySelector(`.bl-node[data-node-id="${label}"]`)!;
      const drawn = [...node.querySelectorAll('text')]
        .map((t) => t.textContent)
        .join('');
      expect(drawn).toContain('…');
      expect(node.getAttribute('data-full-text')).toBe(label);
    });

    it('leaves a node drawn in full without the attribute, wrapped or not', async () => {
      const svg = await renderBL(
        'boxes-and-lines\nPaymentGatewayService\nDB\nPaymentGatewayService -> DB'
      );
      expect(svg.querySelectorAll('[data-full-text]').length).toBe(0);
    });
  });

  describe('mindmap', () => {
    it('puts the full label on a node whose label is cut', () => {
      const label = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
      const svg = parseSvg(
        renderMindmapForExport(`mindmap Root\n  ${label}`, 'light', P)
      );
      const marked = [...svg.querySelectorAll('[data-full-text]')];
      expect(marked.length).toBe(1);
      expect(marked[0]!.getAttribute('data-line-number')).not.toBeNull();
      expect(marked[0]!.getAttribute('data-full-text')).toBe(label);
      expect(marked[0]!.hasAttribute('tabindex')).toBe(false);
    });

    it('puts the full label and description on a node whose description is cut', () => {
      const svg = parseSvg(
        renderMindmapForExport(
          `mindmap Root\n  Task description: ${LONG}`,
          'light',
          P
        )
      );
      const marked = [...svg.querySelectorAll('[data-full-text]')];
      expect(marked.length).toBe(1);
      expect(marked[0]!.getAttribute('data-full-text')).toBe(`Task\n${LONG}`);
    });

    it('leaves a wrapped label drawn in full without the attribute', () => {
      const svg = parseSvg(
        renderMindmapForExport(
          'mindmap Root\n  A label that wraps onto two lines',
          'light',
          P
        )
      );
      expect(svg.querySelectorAll('[data-full-text]').length).toBe(0);
    });
  });

  describe('infra', () => {
    it('puts the full label and description on a selected node whose description is cut', () => {
      const svg = renderInfraSvg(
        `infra\nedge\n  -> API\nAPI\n  description: ${LONG}`,
        'API'
      );
      const api = svg.querySelector('[data-infra-node="api"]')!;
      expect(api.getAttribute('data-line-number')).not.toBeNull();
      expect(api.getAttribute('data-full-text')).toBe(`API\n${LONG}`);
      expect(api.hasAttribute('tabindex')).toBe(false);
    });

    it('leaves a selected node with a short description without the attribute', () => {
      const svg = renderInfraSvg(
        'infra\nedge\n  -> API\nAPI\n  description: Short',
        'API'
      );
      expect(svg.querySelectorAll('[data-full-text]').length).toBe(0);
    });
  });
});
