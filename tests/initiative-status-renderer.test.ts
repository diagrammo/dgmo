import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseInitiativeStatus } from '../src/initiative-status/parser';
import { layoutInitiativeStatus } from '../src/initiative-status/layout';
import { renderInitiativeStatus } from '../src/initiative-status/renderer';
import type { PaletteColors } from '../src/palettes/types';

// Set up jsdom globals for D3
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  Object.defineProperty(globalThis, 'document', {
    value: win.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: win.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    value: win.SVGElement,
    configurable: true,
  });
});

// Minimal Nord light palette for testing
const testPalette: PaletteColors = {
  bg: '#eceff4',
  surface: '#e5e9f0',
  overlay: '#e5e9f0',
  border: '#d8dee9',
  text: '#2e3440',
  textMuted: '#4c566a',
  primary: '#5e81ac',
  secondary: '#81a1c1',
  accent: '#88c0d0',
  destructive: '#bf616a',
  colors: {
    red: '#bf616a',
    orange: '#d08770',
    yellow: '#ebcb8b',
    green: '#a3be8c',
    blue: '#5e81ac',
    purple: '#b48ead',
    teal: '#8fbcbb',
    cyan: '#88c0d0',
    gray: '#4c566a',
  },
};

const SAMPLE = `chart: initiative-status
title: Project Phoenix

Mobile | done
Back End | wip
Database | done

Mobile -> Back End: getUser | done
Back End -> Database: query | done`;

describe('layoutInitiativeStatus', () => {
  it('positions nodes for a simple diagram', () => {
    const parsed = parseInitiativeStatus(SAMPLE);
    const layout = layoutInitiativeStatus(parsed);

    expect(layout.nodes).toHaveLength(3);
    expect(layout.edges).toHaveLength(2);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);

    // All nodes should have positions
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThan(0);
      expect(node.y).toBeGreaterThan(0);
      expect(node.width).toBeGreaterThan(0);
    }
  });

  it('handles empty diagram', () => {
    const parsed = parseInitiativeStatus('chart: initiative-status');
    const layout = layoutInitiativeStatus(parsed);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
  });
});

describe('renderInitiativeStatus', () => {
  it('renders without errors', () => {
    const parsed = parseInitiativeStatus(SAMPLE);
    const layout = layoutInitiativeStatus(parsed);
    const container = document.createElement('div') as unknown as HTMLDivElement;

    renderInitiativeStatus(
      container,
      parsed,
      layout,
      testPalette,
      false,
      undefined,
      { width: 800, height: 600 }
    );

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('creates node elements with data-line-number', () => {
    const parsed = parseInitiativeStatus(SAMPLE);
    const layout = layoutInitiativeStatus(parsed);
    const container = document.createElement('div') as unknown as HTMLDivElement;

    renderInitiativeStatus(
      container,
      parsed,
      layout,
      testPalette,
      false,
      undefined,
      { width: 800, height: 600 }
    );

    const nodes = container.querySelectorAll('.is-node');
    expect(nodes.length).toBe(3);

    // Each node should have a data-line-number
    nodes.forEach((node) => {
      expect(node.getAttribute('data-line-number')).toBeTruthy();
    });
  });

  it('creates edge elements', () => {
    const parsed = parseInitiativeStatus(SAMPLE);
    const layout = layoutInitiativeStatus(parsed);
    const container = document.createElement('div') as unknown as HTMLDivElement;

    renderInitiativeStatus(
      container,
      parsed,
      layout,
      testPalette,
      false,
      undefined,
      { width: 800, height: 600 }
    );

    const edges = container.querySelectorAll('.is-edge');
    expect(edges.length).toBe(2);
  });

  it('renders title', () => {
    const parsed = parseInitiativeStatus(SAMPLE);
    const layout = layoutInitiativeStatus(parsed);
    const container = document.createElement('div') as unknown as HTMLDivElement;

    renderInitiativeStatus(
      container,
      parsed,
      layout,
      testPalette,
      false,
      undefined,
      { width: 800, height: 600 }
    );

    const title = container.querySelector('.chart-title');
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe('Project Phoenix');
  });

  it('renders edge labels', () => {
    const parsed = parseInitiativeStatus(SAMPLE);
    const layout = layoutInitiativeStatus(parsed);
    const container = document.createElement('div') as unknown as HTMLDivElement;

    renderInitiativeStatus(
      container,
      parsed,
      layout,
      testPalette,
      false,
      undefined,
      { width: 800, height: 600 }
    );

    const labels = container.querySelectorAll('.is-edge-label');
    expect(labels.length).toBe(2);
    const texts = Array.from(labels).map((l) => l.textContent);
    expect(texts).toContain('getUser');
    expect(texts).toContain('query');
  });

  it('renders in dark mode without errors', () => {
    const parsed = parseInitiativeStatus(SAMPLE);
    const layout = layoutInitiativeStatus(parsed);
    const container = document.createElement('div') as unknown as HTMLDivElement;

    renderInitiativeStatus(
      container,
      parsed,
      layout,
      testPalette,
      true,
      undefined,
      { width: 800, height: 600 }
    );

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });
});
