import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseInfra } from '../src/infra/parser';
import { parseInitiativeStatus } from '../src/initiative-status/parser';
import { render } from '../src/render';

const FIXTURE_DIR = resolve(__dirname, '../test-fixtures');

describe('stress fixtures', () => {
  describe('infra-stress.dgmo', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'infra-stress.dgmo'), 'utf-8');

    it('parses without errors', () => {
      const result = parseInfra(content);
      expect(result.error).toBeNull();
      const errors = result.diagnostics.filter((d) => d.severity === 'error');
      expect(errors).toEqual([]);
    });

    it('has 30+ nodes', () => {
      const result = parseInfra(content);
      expect(result.nodes.length).toBeGreaterThanOrEqual(30);
    });

    it('has groups with metadata', () => {
      const result = parseInfra(content);
      expect(result.groups.length).toBeGreaterThanOrEqual(6);
    });

    it('has async edges', () => {
      const result = parseInfra(content);
      const asyncEdges = result.edges.filter((e) => e.async);
      expect(asyncEdges.length).toBeGreaterThanOrEqual(5);
    });

    it('has tag groups', () => {
      const result = parseInfra(content);
      expect(result.tagGroups.length).toBeGreaterThanOrEqual(2);
    });

    it('renders non-empty SVG', async () => {
      const svg = await render(content);
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg.length).toBeGreaterThan(1000);
    });
  });

  describe('initiative-status-stress.dgmo', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'initiative-status-stress.dgmo'), 'utf-8');

    it('parses without errors', () => {
      const result = parseInitiativeStatus(content);
      expect(result.error).toBeNull();
      const errors = result.diagnostics.filter((d) => d.severity === 'error');
      expect(errors).toEqual([]);
    });

    it('has all 5 status types', () => {
      const result = parseInitiativeStatus(content);
      const statuses = new Set(result.nodes.map((node) => node.status));
      expect(statuses.has('done')).toBe(true);
      expect(statuses.has('doing')).toBe(true);
      expect(statuses.has('blocked')).toBe(true);
      expect(statuses.has('todo')).toBe(true);
      expect(statuses.has('na')).toBe(true);
    });

    it('has groups with metadata', () => {
      const result = parseInitiativeStatus(content);
      expect(result.groups.length).toBeGreaterThanOrEqual(6);
    });

    it('has many dependency edges', () => {
      const result = parseInitiativeStatus(content);
      expect(result.edges.length).toBeGreaterThanOrEqual(20);
    });

    it('has tag groups', () => {
      const result = parseInitiativeStatus(content);
      expect(result.tagGroups.length).toBeGreaterThanOrEqual(3);
    });

    it('renders non-empty SVG', async () => {
      const svg = await render(content);
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg.length).toBeGreaterThan(1000);
    });
  });
});
