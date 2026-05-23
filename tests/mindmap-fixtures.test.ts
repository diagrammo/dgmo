import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseMindmap } from '../src/mindmap/parser';
import { getPalette } from '../src/palettes';

const palette = getPalette('bold').light;
const FIXTURE_DIR = resolve(__dirname, 'fixtures/mindmap');

const FIXTURE_FILES = [
  'basic.dgmo',
  'multi-root.dgmo',
  'single-node.dgmo',
  'one-child.dgmo',
  'deep-unbalanced.dgmo',
  'all-collapsed.dgmo',
  'empty-description.dgmo',
  'tags-and-colors.dgmo',
];

describe('mindmap fixtures', () => {
  for (const file of FIXTURE_FILES) {
    it(`${file} parses without errors`, () => {
      const content = readFileSync(resolve(FIXTURE_DIR, file), 'utf-8');
      const result = parseMindmap(content, palette);
      expect(result.error).toBeFalsy();
      expect(result.roots.length).toBeGreaterThan(0);
    });
  }

  it('basic has title and tag groups', () => {
    const content = readFileSync(resolve(FIXTURE_DIR, 'basic.dgmo'), 'utf-8');
    const result = parseMindmap(content, palette);
    expect(result.title).toBe('Product Strategy');
    expect(result.tagGroups).toHaveLength(1);
    expect(result.roots).toHaveLength(1);
    // Root is "Product Strategy" with children "Research", "Development"
    expect(result.roots[0].children.length).toBeGreaterThanOrEqual(2);
  });

  it('multi-root has two roots and no title on first line', () => {
    const content = readFileSync(
      resolve(FIXTURE_DIR, 'multi-root.dgmo'),
      'utf-8'
    );
    const result = parseMindmap(content, palette);
    expect(result.roots).toHaveLength(2);
    expect(result.roots[0].label).toBe('Q1 Goals');
    expect(result.roots[1].label).toBe('Q2 Goals');
  });

  it('single-node is valid with one root and no children', () => {
    const content = readFileSync(
      resolve(FIXTURE_DIR, 'single-node.dgmo'),
      'utf-8'
    );
    const result = parseMindmap(content, palette);
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0].label).toBe('My Idea');
    expect(result.roots[0].children).toHaveLength(0);
  });

  it('one-child has root with one child', () => {
    const content = readFileSync(
      resolve(FIXTURE_DIR, 'one-child.dgmo'),
      'utf-8'
    );
    const result = parseMindmap(content, palette);
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0].children).toHaveLength(1);
  });

  it('deep-unbalanced has heavy branch with 10 children', () => {
    const content = readFileSync(
      resolve(FIXTURE_DIR, 'deep-unbalanced.dgmo'),
      'utf-8'
    );
    const result = parseMindmap(content, palette);
    const root = result.roots[0];
    const heavy = root.children.find((c) => c.label === 'Heavy Branch');
    expect(heavy?.children).toHaveLength(10);
  });

  it('all-collapsed has collapsed flags on phase nodes', () => {
    const content = readFileSync(
      resolve(FIXTURE_DIR, 'all-collapsed.dgmo'),
      'utf-8'
    );
    const result = parseMindmap(content, palette);
    for (const child of result.roots[0].children) {
      expect(child.collapsed).toBe(true);
    }
  });

  it('empty-description emits W_EMPTY_METADATA_VALUE and skips field', () => {
    const content = readFileSync(
      resolve(FIXTURE_DIR, 'empty-description.dgmo'),
      'utf-8'
    );
    const result = parseMindmap(content, palette);
    const taskA = result.roots[0].children.find((c) => c.label === 'Task A');
    const taskB = result.roots[0].children.find((c) => c.label === 'Task B');
    expect(taskA?.description).toBeUndefined();
    expect(taskB?.description).toEqual(['Has a description']);
    const warn = result.diagnostics.find(
      (d) => d.code === 'W_EMPTY_METADATA_VALUE'
    );
    expect(warn).toBeDefined();
  });

  it('tags-and-colors has multiple tag groups and options', () => {
    const content = readFileSync(
      resolve(FIXTURE_DIR, 'tags-and-colors.dgmo'),
      'utf-8'
    );
    const result = parseMindmap(content, palette);
    expect(result.tagGroups).toHaveLength(2);
    expect(result.options['active-tag']).toBe('Priority');
    expect(result.options['no-descriptions']).toBe('true');
    expect(result.roots[0].color).toBeUndefined(); // color suffix no longer extracted
  });
});
