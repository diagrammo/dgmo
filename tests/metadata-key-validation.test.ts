import { describe, it, expect } from 'vitest';
import { parseMindmap } from '../src/mindmap/parser';
import { parseKanban } from '../src/kanban/parser';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { parseInfra } from '../src/infra/parser';
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

  it('warns on infra node pipe metadata typo with suggestion', () => {
    const r = parseInfra('infra\n[Web]\n  Server colur: red');
    const diag = r.diagnostics.find((d) =>
      d.message.includes('Unknown metadata key')
    );
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('"colur"');
    expect(diag!.message).toContain("Did you mean 'color'");
  });

  it('does not warn on valid infra node pipe metadata key', () => {
    const r = parseInfra('infra\n[Web]\n  Server color: red');
    const diag = r.diagnostics.find((d) =>
      d.message.includes('Unknown metadata key')
    );
    expect(diag).toBeUndefined();
  });

  it('warns on infra group pipe metadata typo', () => {
    const r = parseInfra('infra\n[Web] | colur: red\n  Server');
    const diag = r.diagnostics.find((d) =>
      d.message.includes('Unknown metadata key')
    );
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('"colur"');
  });

  it('does not warn on infra tag alias key', () => {
    const r = parseInfra(
      'infra\ntag Status as s\n  Active\n  Down\n\n[Web]\n  Server s: Active'
    );
    const diag = r.diagnostics.find((d) =>
      d.message.includes('Unknown metadata key')
    );
    expect(diag).toBeUndefined();
  });

  it('warns on infra connection pipe metadata typo', () => {
    const r = parseInfra(
      'infra\n[Web]\n  Server\n    -> Database | splut: 50%'
    );
    const diag = r.diagnostics.find((d) =>
      d.message.includes('Unknown metadata key')
    );
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('"splut"');
    expect(diag!.message).toContain("Did you mean 'split'");
  });

  it('does not warn on valid infra connection pipe metadata key', () => {
    const r = parseInfra(
      'infra\n[Web]\n  Server\n    -> Database | split: 50%'
    );
    const diag = r.diagnostics.find((d) =>
      d.message.includes('Unknown metadata key')
    );
    expect(diag).toBeUndefined();
  });
});
