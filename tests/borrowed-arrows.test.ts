// Mermaid's arrow spellings drew a wrong diagram with no diagnostic
// (diagrammo/diagrammo#2174, from an outside report on diagrammo/dgmo#40).
// `A --> B` on boxes-and-lines drew a box named "A -"; `A -.-> B` an edge
// labelled "."; the MCP validate_diagram called both valid. Each now warns and
// writes the line the author meant.
import { describe, expect, it } from 'vitest';
import { validate } from '../src/index';

const CODE = 'W_BORROWED_ARROW';
const found = (src: string) =>
  validate(src).diagnostics.filter((d) => d.code === CODE);
const one = (src: string) => {
  const hits = found(src);
  expect(hits, src).toHaveLength(1);
  return hits[0]!;
};

const BL = 'boxes-and-lines T\nA\nB\n';

describe('borrowed arrow spellings warn and give the dgmo line', () => {
  it.each([
    ['A --> B', '-->', 'A -> B'],
    ['A ---> B', '--->', 'A -> B'],
    ['A -- calls --> B', '-- calls -->', 'A -calls-> B'],
    ['A --calls--> B', '--calls-->', 'A -calls-> B'],
    ['A -.-> B', '-.->', 'A -> B'],
    ['A -. calls .-> B', '-. calls .->', 'A -calls-> B'],
    ['A ==> B', '==>', 'A -> B'],
    ['A == calls ==> B', '== calls ==>', 'A -calls-> B'],
    ['A ..> B', '..>', 'A -> B'],
    ['A -dashed-> B', '-dashed->', 'A -> B'],
    ['A -Dotted-> B', '-Dotted->', 'A -> B'],
    ['A --- B', '---', 'A -> B'],
  ])('%s', (edge, token, fixed) => {
    const d = one(BL + edge);
    expect(d.severity).toBe('warning');
    expect(d.line).toBe(4);
    expect(d.message).toContain(`\`${token}\` is not a dgmo arrow`);
    expect(d.message).toContain(`Write \`${fixed}\``);
    expect(d.message).toContain('no dashed edges on boxes-and-lines');
  });

  it('is silent on correct arrows', () => {
    for (const edge of ['A -> B', 'A -calls-> B', 'A -re-try-> B', 'A-B -> C'])
      expect(found(BL + edge), edge).toEqual([]);
  });

  it('reaches every chart type whose edges are `->`', () => {
    const docs: Record<string, string> = {
      flowchart: 'flowchart T\n[A] --> [B]',
      state: 'state T\nA --> B',
      sequence: 'sequence T\nA --> B',
      sitemap: 'sitemap T\nHome\n  --> About\nAbout',
      infra: 'infra T\nedge\n  --> API\nAPI',
      map: 'map T\nLHR --> JFK',
    };
    for (const [type, src] of Object.entries(docs))
      expect(found(src), type).toHaveLength(1);
  });

  it('names the dashed line a chart type does have', () => {
    expect(one('infra T\nedge\n  --> API\nAPI').message).toContain(
      '`~>` draws a dashed async edge'
    );
  });

  it('leaves class and ER grammars alone', () => {
    expect(found('class T\nA\n  ..> B\nB')).toEqual([]);
    expect(found('class T\nA\n  --|> B\nB')).toEqual([]);
  });

  it('keeps map `--`, an undirected edge there', () => {
    expect(found('map T\nLHR -- JFK')).toEqual([]);
  });

  it('ignores the title line, comments, quoted names and text lines', () => {
    expect(found('boxes-and-lines A --> B\nA\nB\nA -> B')).toEqual([]);
    expect(found(BL + '// A --> B\nA -> B')).toEqual([]);
    expect(found(BL + '"x --> y"\nA -> "x --> y"')).toEqual([]);
    expect(found(BL + 'subtitle from A --> B\nA -> B')).toEqual([]);
  });

  it('reaches the MCP validate text, which called these valid', async () => {
    const { validateDiagram, formatDiagramValidation } =
      await import('../src/validate-diagram');
    const text = formatDiagramValidation(validateDiagram(BL + 'A --> B')).text;
    expect(text).toContain('Valid with 1 warning');
    expect(text).toContain('`-->` is not a dgmo arrow');
  });
});
