import { describe, it, expect } from 'vitest';
import {
  encodeDiagramUrl,
  decodeDiagramUrl,
  encodeViewState,
  decodeViewState,
} from '../src/sharing';
import type { CompactViewState } from '../src/sharing';

describe('encodeDiagramUrl / decodeDiagramUrl', () => {
  const samples = [
    { name: 'pie chart', dsl: 'pie\nA: 10\nB: 20\nC: 30' },
    { name: 'sequence diagram', dsl: 'sequence\nA -hello-> B\nB -world-> A' },
    { name: 'bar chart', dsl: 'bar\nApples: 40\nOranges: 25\nBananas: 60' },
    {
      name: 'unicode content',
      dsl: 'pie\n日本語: 10\nEmoji 🎉: 20\nÜmlaut: 30',
    },
    {
      name: 'long lines',
      dsl: 'sequence\n' + 'A -' + 'x'.repeat(500) + '-> B',
    },
    { name: 'empty DSL', dsl: '' },
  ];

  for (const { name, dsl } of samples) {
    it(`round-trips ${name}`, () => {
      const result = encodeDiagramUrl(dsl);
      if (result.error) {
        throw new Error(`Unexpected error for ${name}: ${result.error}`);
      }
      const query = new URL(result.url).search;
      expect(decodeDiagramUrl(query).dsl).toBe(dsl);
    });
  }

  it('uses the default base URL with both query and hash', () => {
    const result = encodeDiagramUrl('pie\nA: 10');
    if (result.error) throw new Error('unexpected error');
    expect(result.url).toMatch(
      /^https:\/\/online\.diagrammo\.app\?dgmo=.+#dgmo=/
    );
  });

  it('accepts a custom base URL', () => {
    const result = encodeDiagramUrl('pie\nA: 10', {
      baseUrl: 'https://example.com/playground',
    });
    if (result.error) throw new Error('unexpected error');
    expect(result.url).toMatch(
      /^https:\/\/example\.com\/playground\?dgmo=.+#dgmo=/
    );
  });

  it('decodes from hash when query is stripped', () => {
    const result = encodeDiagramUrl('pie\nA: 10');
    if (result.error) throw new Error('unexpected error');
    const hash = new URL(result.url).hash;
    expect(decodeDiagramUrl(hash).dsl).toBe('pie\nA: 10');
  });

  describe('size limit enforcement', () => {
    it('rejects payloads exceeding 8 KB compressed', () => {
      // Generate a large payload that compresses to > 8 KB
      // Random-ish data compresses poorly — use unique lines
      const lines = Array.from(
        { length: 2000 },
        (_, i) => `item_${i}_${Math.random()}: ${i}`
      );
      const largeDsl = 'bar\n' + lines.join('\n');

      const result = encodeDiagramUrl(largeDsl);
      expect(result.error).toBe('too-large');
      if (result.error === 'too-large') {
        expect(result.compressedSize).toBeGreaterThan(8192);
        expect(result.limit).toBe(8192);
      }
    });

    it('30-task × 8-role RACI fits within the 8 KB compressed limit', () => {
      // Realistic ceiling for v1 — most authored RACIs are well under this.
      // If this ever crosses 8 KB, revisit per TD #23 before introducing
      // a separate cp= field for collapsed phases.
      const roles = ['Cap', 'QM', 'Bos', 'Nav', 'Crew', 'Cook', 'Mate', 'Doc'];
      const lines: string[] = ['raci Voyage Operations', 'roles'];
      for (const r of roles) lines.push(`  ${r}`);
      lines.push('');
      const phases = ['Departure', 'At Sea', 'Landfall'];
      let taskNo = 1;
      for (const phase of phases) {
        lines.push(`[${phase}]`);
        const tasksInPhase = phase === 'At Sea' ? 12 : 9;
        for (let i = 0; i < tasksInPhase; i++) {
          lines.push(`  Task ${taskNo++}`);
          lines.push(`    ${roles[i % roles.length]}: A`);
          lines.push(`    ${roles[(i + 1) % roles.length]}: R`);
          lines.push(`    ${roles[(i + 2) % roles.length]}: C`);
        }
      }
      const dsl = lines.join('\n');
      const result = encodeDiagramUrl(dsl, {
        viewState: { cs: [4, 13, 25] },
      });
      expect(result.error).toBeUndefined();
      // Round-trip preserves both DSL and view state.
      if (!result.url) throw new Error('expected url');
      const decoded = decodeDiagramUrl(new URL(result.url).search);
      expect(decoded.dsl).toBe(dsl);
      expect(decoded.viewState.cs).toEqual([4, 13, 25]);
    });
  });

  describe('decodeDiagramUrl edge cases', () => {
    it('handles query with ? prefix', () => {
      const result = encodeDiagramUrl('pie\nA: 10');
      if (result.error) throw new Error('unexpected error');
      const query = new URL(result.url).search; // includes ?
      expect(decodeDiagramUrl(query).dsl).toBe('pie\nA: 10');
    });

    it('handles query without ? prefix', () => {
      const result = encodeDiagramUrl('pie\nA: 10');
      if (result.error) throw new Error('unexpected error');
      const query = new URL(result.url).search.slice(1); // strip ?
      expect(decodeDiagramUrl(query).dsl).toBe('pie\nA: 10');
    });

    it('handles bare payload (no dgmo= prefix)', () => {
      const result = encodeDiagramUrl('pie\nA: 10');
      if (result.error) throw new Error('unexpected error');
      const payload = new URL(result.url).search.replace('?dgmo=', '');
      expect(decodeDiagramUrl(payload).dsl).toBe('pie\nA: 10');
    });

    it('backwards compat: handles hash with # prefix', () => {
      const result = encodeDiagramUrl('pie\nA: 10');
      if (result.error) throw new Error('unexpected error');
      // Simulate old-style URL with hash fragment
      const query = new URL(result.url).search.slice(1); // dgmo=...
      expect(decodeDiagramUrl(`#${query}`).dsl).toBe('pie\nA: 10');
    });

    it('returns empty dsl for invalid payload', () => {
      const decoded = decodeDiagramUrl('not-valid-lz-data!!!');
      expect(decoded.dsl).toBe('');
      expect(decoded.viewState).toEqual({});
    });

    it('returns empty dsl for empty input', () => {
      expect(decodeDiagramUrl('')).toEqual({ dsl: '', viewState: {} });
    });

    it('returns empty dsl for just #', () => {
      expect(decodeDiagramUrl('#')).toEqual({ dsl: '', viewState: {} });
    });

    it('returns empty dsl for just #dgmo=', () => {
      const decoded = decodeDiagramUrl('#dgmo=');
      expect(decoded.dsl).toBe('');
      expect(decoded.viewState).toEqual({});
    });
  });

  describe('view state (vs= param)', () => {
    it('round-trips with activeTagGroup override', () => {
      const dsl = 'org\nCEO\n  VP Engineering';
      const result = encodeDiagramUrl(dsl, {
        viewState: { tag: 'Location' },
      });
      if (result.error) throw new Error('unexpected error');
      expect(result.url).toContain('&vs=');
      const query = new URL(result.url).search;
      const decoded = decodeDiagramUrl(query);
      expect(decoded.dsl).toBe(dsl);
      expect(decoded.viewState.tag).toBe('Location');
    });

    it('omits vs= when viewState is empty object', () => {
      const result = encodeDiagramUrl('org\nCEO', { viewState: {} });
      if (result.error) throw new Error('unexpected error');
      expect(result.url).not.toContain('&vs=');
    });

    it('omits vs= when viewState is not provided', () => {
      const result = encodeDiagramUrl('org\nCEO');
      if (result.error) throw new Error('unexpected error');
      expect(result.url).not.toContain('&vs=');
    });

    it('returns empty viewState when no vs= param present', () => {
      const result = encodeDiagramUrl('org\nCEO');
      if (result.error) throw new Error('unexpected error');
      const query = new URL(result.url).search;
      const decoded = decodeDiagramUrl(query);
      expect(decoded.viewState).toEqual({});
    });

    it('distinguishes tag: null from absent tag', () => {
      // tag: null means "user chose none"
      const withNull = encodeDiagramUrl('org\nCEO', {
        viewState: { tag: null },
      });
      if (withNull.error) throw new Error('unexpected error');
      expect(withNull.url).toContain('&vs=');
      const decodedNull = decodeDiagramUrl(new URL(withNull.url).search);
      expect(decodedNull.viewState.tag).toBeNull();

      // absent tag means "use DSL default"
      const withoutTag = encodeDiagramUrl('org\nCEO', { viewState: {} });
      if (withoutTag.error) throw new Error('unexpected error');
      const decodedAbsent = decodeDiagramUrl(new URL(withoutTag.url).search);
      expect(decodedAbsent.viewState.tag).toBeUndefined();
    });
  });

  describe('view state round-trips per chart type', () => {
    const chartStates: { name: string; state: CompactViewState }[] = [
      {
        name: 'sequence',
        state: { tag: 'Team', cs: [12, 45, 78], cg: ['group-1', 'group-2'] },
      },
      {
        name: 'gantt',
        state: {
          tag: 'Sprint',
          cg: ['Phase 1'],
          swim: 'Team',
          cl: ['QA', 'Eng'],
        },
      },
      {
        name: 'c4',
        state: {
          tag: 'Environment',
          c4l: 'components',
          c4s: 'API Gateway',
          c4c: 'Auth Service',
        },
      },
      { name: 'er', state: { sem: false, tag: 'Module' } },
      {
        name: 'infra',
        state: {
          tag: 'Region',
          cg: ['us-east', 'eu-west'],
          rps: 5,
          spd: 2,
          io: { 'web-server': 4, 'api-server': 8 },
        },
      },
      {
        name: 'sitemap',
        state: { tag: 'Status', cg: ['archive'], ha: ['description', 'url'] },
      },
      {
        name: 'boxes-and-lines',
        state: {
          tag: 'Priority',
          cg: ['helpers'],
          rm: 'shapes',
          htv: { Priority: ['low', 'medium'] },
        },
      },
      {
        name: 'kanban',
        state: {
          tag: 'Assignee',
          swim: 'Sprint',
          cl: ['Done'],
          cc: ['Backlog'],
          cm: true,
        },
      },
      {
        name: 'timeline',
        state: { tag: 'Outcome', swim: 'Pirate' },
      },
      {
        name: 'org',
        state: {
          tag: 'Location',
          cg: ['node-5', 'node-12'],
          ha: ['email'],
        },
      },
      {
        name: 'raci',
        // RACI phases ride on existing `cs` field per TD #23 — no schema
        // change. Phase line numbers are stable for a fixed DSL revision,
        // which is what `cs` already represents for sequence sections.
        state: { cs: [4, 12, 20] },
      },
    ];

    for (const { name, state } of chartStates) {
      it(`round-trips ${name} view state`, () => {
        const dsl = `${name === 'boxes-and-lines' ? 'graph' : name}\nA`;
        const result = encodeDiagramUrl(dsl, { viewState: state });
        if (result.error) throw new Error(`unexpected error for ${name}`);
        const query = new URL(result.url).search;
        const decoded = decodeDiagramUrl(query);
        expect(decoded.viewState).toEqual(state);
      });
    }
  });

  describe('view state (palette + theme)', () => {
    it('round-trips palette: catppuccin', () => {
      const dsl = 'pie\nA: 10';
      const result = encodeDiagramUrl(dsl, { palette: 'catppuccin' });
      if (result.error) throw new Error('unexpected error');
      expect(result.url).toContain('&pal=catppuccin');
      const query = new URL(result.url).search;
      const decoded = decodeDiagramUrl(query);
      expect(decoded.palette).toBe('catppuccin');
    });

    it('round-trips theme: light', () => {
      const dsl = 'pie\nA: 10';
      const result = encodeDiagramUrl(dsl, { theme: 'light' });
      if (result.error) throw new Error('unexpected error');
      expect(result.url).toContain('&th=light');
      const query = new URL(result.url).search;
      const decoded = decodeDiagramUrl(query);
      expect(decoded.theme).toBe('light');
    });

    it('round-trips palette + theme + viewState together', () => {
      const dsl = 'org\nCEO';
      const result = encodeDiagramUrl(dsl, {
        viewState: { tag: 'Team' },
        palette: 'catppuccin',
        theme: 'light',
      });
      if (result.error) throw new Error('unexpected error');
      expect(result.url).toContain('&pal=catppuccin');
      expect(result.url).toContain('&th=light');
      expect(result.url).toContain('&vs=');
      const query = new URL(result.url).search;
      const decoded = decodeDiagramUrl(query);
      expect(decoded.palette).toBe('catppuccin');
      expect(decoded.theme).toBe('light');
      expect(decoded.viewState.tag).toBe('Team');
    });

    it('omits &pal= when palette is nord (default)', () => {
      const result = encodeDiagramUrl('pie\nA: 10', { palette: 'nord' });
      if (result.error) throw new Error('unexpected error');
      expect(result.url).not.toContain('&pal=');
    });

    it('omits &th= when theme is dark (default)', () => {
      const result = encodeDiagramUrl('pie\nA: 10', { theme: 'dark' });
      if (result.error) throw new Error('unexpected error');
      expect(result.url).not.toContain('&th=');
    });

    it('ignores unknown &th= values — transparent → theme undefined', () => {
      const result = encodeDiagramUrl('pie\nA: 10');
      if (result.error) throw new Error('unexpected error');
      const query =
        new URL(result.url).search.replace('?', '') + '&th=transparent';
      const decoded = decodeDiagramUrl(query);
      expect(decoded.theme).toBeUndefined();
    });

    it('URL without &pal= → palette is undefined (not nord)', () => {
      const result = encodeDiagramUrl('pie\nA: 10');
      if (result.error) throw new Error('unexpected error');
      const query = new URL(result.url).search;
      const decoded = decodeDiagramUrl(query);
      expect(decoded.palette).toBeUndefined();
    });
  });

  describe('filename', () => {
    it('round-trips filename', () => {
      const dsl = 'pie\nA: 10';
      const result = encodeDiagramUrl(dsl, { filename: 'my-chart.dgmo' });
      if (result.error) throw new Error('unexpected error');
      expect(result.url).toContain('&fn=my-chart.dgmo');
      const query = new URL(result.url).search;
      const decoded = decodeDiagramUrl(query);
      expect(decoded.filename).toBe('my-chart.dgmo');
    });
  });
});

describe('encodeViewState / decodeViewState', () => {
  it('returns empty string for empty state', () => {
    expect(encodeViewState({})).toBe('');
  });

  it('round-trips a simple state', () => {
    const state: CompactViewState = { tag: 'Team', cs: [1, 2, 3] };
    const encoded = encodeViewState(state);
    expect(encoded).not.toBe('');
    const decoded = decodeViewState(encoded);
    expect(decoded).toEqual(state);
  });

  it('round-trips tag: null correctly', () => {
    const state: CompactViewState = { tag: null };
    const encoded = encodeViewState(state);
    const decoded = decodeViewState(encoded);
    expect(decoded.tag).toBeNull();
  });

  it('round-trips all fields populated', () => {
    const state: CompactViewState = {
      tag: 'Region',
      cs: [10, 20, 30],
      cg: ['node-1', 'node-2'],
      swim: 'Team',
      cl: ['Done', 'Blocked'],
      cc: ['Backlog'],
      rm: 'shapes',
      htv: { Priority: ['low'], Status: ['draft'] },
      ha: ['description'],
      sem: true,
      cm: false,
      c4l: 'components',
      c4s: 'API',
      c4c: 'Auth',
      rps: 5,
      spd: 2,
      io: { web: 4 },
    };
    const encoded = encodeViewState(state);
    const decoded = decodeViewState(encoded);
    expect(decoded).toEqual(state);
  });

  it('returns empty object for malformed input', () => {
    expect(decodeViewState('not-valid-lz-data!!!')).toEqual({});
  });

  it('returns empty object for empty string', () => {
    expect(decodeViewState('')).toEqual({});
  });

  it('round-trips kanban view state (swim, cl, cc, cm)', () => {
    const state: CompactViewState = {
      tag: 'Crew',
      swim: 'Crew',
      cl: ['Blackbeard'],
      cc: ['Done'],
      cm: true,
    };
    const encoded = encodeViewState(state);
    expect(encoded).not.toBe('');
    const decoded = decodeViewState(encoded);
    expect(decoded).toEqual(state);
  });

  it('round-trips partial kanban state (swim only)', () => {
    const state: CompactViewState = { swim: 'Crew' };
    const encoded = encodeViewState(state);
    const decoded = decodeViewState(encoded);
    expect(decoded).toEqual(state);
  });

  it('large state stays under 8KB with typical DSL', () => {
    const state: CompactViewState = {
      tag: 'Region',
      cs: Array.from({ length: 50 }, (_, i) => i),
      cg: Array.from({ length: 20 }, (_, i) => `node-${i}`),
      swim: 'Team',
      cl: Array.from({ length: 10 }, (_, i) => `lane-${i}`),
      htv: { Priority: ['low', 'medium', 'high'] },
      ha: ['description', 'url', 'status'],
    };
    const encoded = encodeViewState(state);
    const byteSize = new TextEncoder().encode(encoded).byteLength;
    // State blob alone should be well under 8KB
    expect(byteSize).toBeLessThan(8192);
  });
});
