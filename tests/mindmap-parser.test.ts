import { describe, it, expect } from 'vitest';
import { parseMindmap } from '../src/mindmap/parser';
import { getPalette } from '../src/palettes';

const palette = getPalette('bold').light;

describe('parseMindmap', () => {
  // ── Title parsing ───────────────────────────────────────────

  it('parses title from first line', () => {
    const result = parseMindmap('mindmap Product Strategy\n  Feature A');
    expect(result.title).toBe('Product Strategy');
    expect(result.titleLineNumber).toBe(1);
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0].label).toBe('Product Strategy');
  });

  it('title becomes root node with correct id and lineNumber', () => {
    const result = parseMindmap('mindmap My Map\n  Child');
    const root = result.roots[0];
    expect(root.id).toBe('node-1');
    expect(root.lineNumber).toBe(1);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].label).toBe('Child');
  });

  it('handles no title (title-less mindmap)', () => {
    const result = parseMindmap('mindmap\n\nNode A\nNode B');
    expect(result.roots).toHaveLength(2);
    expect(result.roots[0].label).toBe('Node A');
    expect(result.roots[1].label).toBe('Node B');
    // Title inferred from first root
    expect(result.title).toBe('Node A');
  });

  // ── Hierarchy ───────────────────────────────────────────────

  it('builds correct parent-child hierarchy via indentation', () => {
    const result = parseMindmap(
      `mindmap Root
  Level 1a
    Level 2a
    Level 2b
  Level 1b`
    );
    const root = result.roots[0];
    expect(root.children).toHaveLength(2);
    expect(root.children[0].label).toBe('Level 1a');
    expect(root.children[0].children).toHaveLength(2);
    expect(root.children[0].children[0].label).toBe('Level 2a');
    expect(root.children[0].children[1].label).toBe('Level 2b');
    expect(root.children[1].label).toBe('Level 1b');
    expect(root.children[1].children).toHaveLength(0);
  });

  it('handles deep nesting (4+ levels)', () => {
    const result = parseMindmap(
      `mindmap Root
  L1
    L2
      L3
        L4`
    );
    const l4 = result.roots[0].children[0].children[0].children[0].children[0];
    expect(l4.label).toBe('L4');
    expect(l4.parentId).toBeDefined();
  });

  it('siblings at same indent are siblings', () => {
    const result = parseMindmap(
      `mindmap
A
  B
  C
  D`
    );
    const a = result.roots[0];
    expect(a.children).toHaveLength(3);
    expect(a.children.map((c) => c.label)).toEqual(['B', 'C', 'D']);
  });

  // ── Multi-root ──────────────────────────────────────────────

  it('creates multiple roots when no title and multiple unindented nodes', () => {
    const result = parseMindmap(
      `mindmap

Q1 Goals
  Ship MVP
Q2 Goals
  Launch`
    );
    expect(result.roots).toHaveLength(2);
    expect(result.roots[0].label).toBe('Q1 Goals');
    expect(result.roots[1].label).toBe('Q2 Goals');
  });

  // ── Pipe metadata ──────────────────────────────────────────

  it('parses pipe metadata on nodes', () => {
    const result = parseMindmap(
      `mindmap Root
  Task | priority: High, status: Done`
    );
    const task = result.roots[0].children[0];
    expect(task.metadata['priority']).toBe('High');
    expect(task.metadata['status']).toBe('Done');
  });

  it('extracts description from pipe metadata as dedicated field', () => {
    const result = parseMindmap(
      `mindmap Root
  Surveys | description: Quarterly NPS survey`
    );
    const node = result.roots[0].children[0];
    expect(node.description).toEqual(['Quarterly NPS survey']);
    expect(node.metadata['description']).toBeUndefined();
  });

  it('extracts collapsed flag from pipe metadata', () => {
    const result = parseMindmap(
      `mindmap Root
  Nice-to-haves | collapsed: true`
    );
    const node = result.roots[0].children[0];
    expect(node.collapsed).toBe(true);
    expect(node.metadata['collapsed']).toBeUndefined();
  });

  it('combined pipe metadata with description, collapsed, and tags', () => {
    const result = parseMindmap(
      `mindmap Root
  Node | description: Info, collapsed: true, priority: High`
    );
    const node = result.roots[0].children[0];
    expect(node.description).toEqual(['Info']);
    expect(node.collapsed).toBe(true);
    expect(node.metadata['priority']).toBe('High');
  });

  // ── Indented description ────────────────────────────────────

  it('parses indented description before children', () => {
    const result = parseMindmap(
      `mindmap Root
  Auth System
    description: Handle login, signup, OAuth flows
    Login Page`
    );
    const auth = result.roots[0].children[0];
    expect(auth.description).toEqual(['Handle login, signup, OAuth flows']);
    expect(auth.children).toHaveLength(1);
    expect(auth.children[0].label).toBe('Login Page');
  });

  it('warns on description after children', () => {
    const result = parseMindmap(
      `mindmap Root
  Parent
    Child
    description: Late desc`
    );
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].message).toContain('description after child nodes');
  });

  it('pipe description wins over indented description', () => {
    const result = parseMindmap(
      `mindmap Root
  Node | description: Pipe wins
    description: Indented loses`
    );
    const node = result.roots[0].children[0];
    expect(node.description).toEqual(['Pipe wins', 'Indented loses']);
  });

  it('empty indented description is silently skipped', () => {
    const result = parseMindmap(
      `mindmap Root
  Node
    description:`
    );
    const node = result.roots[0].children[0];
    expect(node.description).toBeUndefined();
    expect(result.diagnostics).toHaveLength(0);
  });

  it('empty pipe description is silently skipped', () => {
    const result = parseMindmap(
      `mindmap Root
  Node | description:`
    );
    const node = result.roots[0].children[0];
    expect(node.description).toBeUndefined();
  });

  // ── Multi-line and keyword variants ─────────────────────────

  it('multi-line description accumulates to array', () => {
    const result = parseMindmap(
      `mindmap Root
  Node
    description line1
    description line2`
    );
    const node = result.roots[0].children[0];
    expect(node.description).toEqual(['line1', 'line2']);
  });

  it('colon optional: both description: text and description text work', () => {
    const result = parseMindmap(
      `mindmap Root
  NodeA
    description: with colon
  NodeB
    description without colon`
    );
    const nodeA = result.roots[0].children[0];
    const nodeB = result.roots[0].children[1];
    expect(nodeA.description).toEqual(['with colon']);
    expect(nodeB.description).toEqual(['without colon']);
  });

  it('bare Description (capitalized, no trailing text) creates a CHILD NODE, not a description', () => {
    const result = parseMindmap(
      `mindmap Root
  Parent
    Description`
    );
    const parent = result.roots[0].children[0];
    // "Description" with no trailing text is not a description keyword — it's a child node
    expect(parent.description).toBeUndefined();
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].label).toBe('Description');
  });

  // ── Non-description indented lines are child nodes ──────────

  it('treats non-description indented key:value as child node', () => {
    const result = parseMindmap(
      `mindmap Root
  Parent
    role: Engineer`
    );
    const parent = result.roots[0].children[0];
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].label).toBe('role: Engineer');
    expect(parent.description).toBeUndefined();
  });

  // ── Tag declarations ────────────────────────────────────────

  it('parses tag declarations with aliases', () => {
    const result = parseMindmap(
      `mindmap Root

tag Priority p
  High red
  Low green

  Task | p: High`,
      palette
    );
    expect(result.tagGroups).toHaveLength(1);
    expect(result.tagGroups[0].name).toBe('Priority');
    expect(result.tagGroups[0].alias).toBe('p');
    expect(result.tagGroups[0].entries).toHaveLength(2);
  });

  it('resolves in pipe metadata via tag group', () => {
    const result = parseMindmap(
      `mindmap Root

tag Priority p
  High red
  Low green

  Task | p: High`,
      palette
    );
    const task = result.roots[0].children[0];
    expect(task.metadata['priority']).toBe('High');
  });

  // ── Color extraction ────────────────────────────────────────

  // ── Options ─────────────────────────────────────────────────

  it('parses no-descriptions option', () => {
    const result = parseMindmap(
      `mindmap Root

no-descriptions

  Child`
    );
    expect(result.options['no-descriptions']).toBe('true');
  });

  it('parses active-tag option', () => {
    const result = parseMindmap(
      `mindmap Root

tag Priority p
  High red

active-tag Priority

  Child`
    );
    expect(result.options['active-tag']).toBe('Priority');
  });

  // ── Edge cases ──────────────────────────────────────────────

  it('returns error for empty content', () => {
    const result = parseMindmap('');
    expect(result.error).toBeTruthy();
  });

  it('single node no children is valid', () => {
    const result = parseMindmap('mindmap My Idea');
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0].label).toBe('My Idea');
    expect(result.error).toBeNull();
  });

  it('skips comment lines', () => {
    const result = parseMindmap(
      `mindmap Root
// comment
  Child`
    );
    expect(result.roots[0].children).toHaveLength(1);
  });

  it('returns error when wrong chart type on first line', () => {
    const result = parseMindmap('org My Chart');
    expect(result.error).toBeTruthy();
  });

  it('tag groups before content do not start content phase', () => {
    const result = parseMindmap(
      `mindmap Root

tag Status s
  Active green
  Done blue

  First Node | s: Active`,
      palette
    );
    expect(result.tagGroups).toHaveLength(1);
    expect(result.roots[0].children).toHaveLength(1);
  });
});
