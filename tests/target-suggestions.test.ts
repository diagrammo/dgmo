import { describe, it, expect } from 'vitest';
import { parseC4 } from '../src/c4/parser';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { parseInfra } from '../src/infra/parser';
import { parseKanban } from '../src/kanban/parser';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

describe('target-not-found suggestions', () => {
  describe('c4 relationship targets', () => {
    it('suggests close match for relationship target typo', () => {
      const r = parseC4(
        'c4\nWeb App is a system\nDatabase is a container\nWeb App\n  -> Databse',
        palette
      );
      const diag = r.diagnostics.find((d) => d.message.includes('not found'));
      expect(diag).toBeDefined();
      expect(diag!.message).toContain('"Databse"');
      expect(diag!.message).toContain('Did you mean');
    });

    it('no suggestion for completely unrelated target', () => {
      const r = parseC4('c4\nWeb App is a system\n  -> Zzzzzzz', palette);
      const diag = r.diagnostics.find((d) => d.message.includes('not found'));
      expect(diag).toBeDefined();
      expect(diag!.message).not.toContain('Did you mean');
    });

    it('no warning when target exists', () => {
      const r = parseC4(
        'c4\nWeb App is a system\nDatabase is a container\nWeb App\n  -> Database',
        palette
      );
      const diag = r.diagnostics.find((d) => d.message.includes('not found'));
      expect(diag).toBeUndefined();
    });
  });

  describe('boxes-and-lines group targets', () => {
    it('suggests close match for group reference typo', () => {
      const r = parseBoxesAndLines(
        'boxes-and-lines\n[Backend]\n  Server\n\nServer -> [Backen]',
        palette
      );
      const diag = r.diagnostics.find((d) => d.message.includes('not found'));
      expect(diag).toBeDefined();
      expect(diag!.message).toContain('Did you mean');
    });

    it('no suggestion for completely unrelated group reference', () => {
      const r = parseBoxesAndLines(
        'boxes-and-lines\n[Backend]\n  Server\n\nServer -> [Zzzzz]',
        palette
      );
      const diag = r.diagnostics.find((d) => d.message.includes('not found'));
      expect(diag).toBeDefined();
      expect(diag!.message).not.toContain('Did you mean');
    });
  });
});

describe('contextual unexpected-line hints', () => {
  it('sequence: hints at valid line types', () => {
    const r = parseSequenceDgmo('sequence\n\nUser -> API\n???invalid???');
    const diag = r.diagnostics.find((d) =>
      d.message.includes('Unexpected line')
    );
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('Expected a message (A -> B)');
  });

  it('infra: hints at top level', () => {
    const r = parseInfra('infra\n???invalid???');
    const diag = r.diagnostics.find((d) =>
      d.message.includes('Unexpected line')
    );
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('Expected a component name');
  });

  it('kanban: hints inside column', () => {
    const r = parseKanban('kanban\n[To Do]\n???invalid???', palette);
    const diag = r.diagnostics.find((d) =>
      d.message.includes('Unexpected line')
    );
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('indented card name');
  });
});
