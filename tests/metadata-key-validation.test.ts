import { describe, it, expect } from 'vitest';
import { parseMindmap } from '../src/mindmap/parser';
import { parseKanban } from '../src/kanban/parser';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

describe('unknown metadata key warnings', () => {
  it('warns on typo with suggestion (mindmap)', () => {
    const r = parseMindmap('mindmap\nRoot colur: red', palette);
    const diag = r.diagnostics.find((d) =>
      d.message.includes('Unknown metadata key')
    );
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('"colur"');
    expect(diag!.message).toContain("Did you mean 'color'");
  });

  it('does not warn on distant mismatch in name (mindmap)', () => {
    const r = parseMindmap('mindmap\nRoot xyz: hello', palette);
    const diag = r.diagnostics.find((d) =>
      d.message.includes('Unknown metadata key')
    );
    expect(diag).toBeUndefined();
  });

  it('does not warn on valid key (mindmap)', () => {
    const r = parseMindmap('mindmap\nRoot color: red', palette);
    const diag = r.diagnostics.find((d) =>
      d.message.includes('Unknown metadata key')
    );
    expect(diag).toBeUndefined();
  });

  it('does not warn on tag alias key (kanban)', () => {
    const r = parseKanban(
      'kanban\ntag Status\n  Open\n  Done\n\n[To Do]\n  Task s: Open',
      palette
    );
    const diag = r.diagnostics.find((d) =>
      d.message.includes('Unknown metadata key')
    );
    expect(diag).toBeUndefined();
  });

  it('warns on typo in name when valid key also present (mindmap)', () => {
    const r = parseMindmap('mindmap\nRoot colur: red, color: blue', palette);
    const diag = r.diagnostics.find((d) =>
      d.message.includes('Unknown metadata key')
    );
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('"colur"');
  });

  it('warns on sequence participant metadata typo', () => {
    const r = parseSequenceDgmo('sequence\n\nAPI rolle: gateway\nUser -> API');
    const diag = r.diagnostics.find((d) =>
      d.message.includes('Unknown metadata key')
    );
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('"rolle"');
    expect(diag!.message).toContain("Did you mean 'role'");
  });
});
