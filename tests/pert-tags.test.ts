import { describe, it, expect } from 'vitest';
import { parsePert } from '../src/pert/parser';
import { analyzePert } from '../src/pert/analyzer';
import { renderPertForExport } from '../src/pert/renderer';

const PALETTE = {
  bg: '#eceff4',
  surface: '#e5e9f0',
  text: '#2e3440',
  textMuted: '#4c566a',
  textOnFillLight: '#2e3440',
  textOnFillDark: '#eceff4',
  primary: '#5e81ac',
  surfaceMuted: '#d8dee9',
  colors: {
    red: '#bf616a',
    orange: '#d08770',
    yellow: '#ebcb8b',
    green: '#a3be8c',
    blue: '#5e81ac',
    purple: '#b48ead',
    teal: '#88c0d0',
    cyan: '#8fbcbb',
    gray: '#d8dee9',
    black: '#2e3440',
    white: '#eceff4',
  },
};

function ok(parsed: ReturnType<typeof parsePert>): void {
  if (parsed.error) throw new Error(parsed.error);
  const errs = parsed.diagnostics.filter((d) => d.severity === 'error');
  if (errs.length) throw new Error(errs.map((e) => e.message).join('\n'));
}

describe('PERT tag declarations', () => {
  it('parses a single tag group with alias and entries', () => {
    const parsed = parsePert(
      `pert\n` +
        `tag Crew as c\n` +
        `  Captain red\n` +
        `  Bosun orange\n\n` +
        `task A 1 2 4`
    );
    ok(parsed);
    expect(parsed.tagGroups).toHaveLength(1);
    const g = parsed.tagGroups[0];
    expect(g.name).toBe('Crew');
    expect(g.alias).toBe('c');
    expect(g.entries.map((e) => e.value)).toEqual(['Captain', 'Bosun']);
    expect(g.defaultValue).toBe('Captain');
  });

  it('parses multiple tag groups in declaration order', () => {
    const parsed = parsePert(
      `pert\n` +
        `tag Crew as c\n  Captain red\n  Bosun orange\n` +
        `tag Risk as r\n  Safe green\n  Critical red\n\n` +
        `task A 1 2 4`
    );
    ok(parsed);
    expect(parsed.tagGroups.map((g) => g.name)).toEqual(['Crew', 'Risk']);
  });

  it('first entry is the default value', () => {
    const parsed = parsePert(
      `pert\n` + `tag Risk as r\n  Safe green\n  Critical red\n\n` + `task A 1`
    );
    ok(parsed);
    expect(parsed.tagGroups[0].defaultValue).toBe('Safe');
  });

  it('rejects a `tag …` heading after activities have started', () => {
    const parsed = parsePert(
      `pert\n` + `task A 1\n` + `tag Crew as c\n  Captain red`
    );
    const tagErr = parsed.diagnostics.find((d) =>
      d.message.includes("'tag' declarations must appear before activities")
    );
    expect(tagErr).toBeDefined();
  });

  it('inline form: `tag Crew as c Captain red, Bosun orange`', () => {
    const parsed = parsePert(
      `pert\n` + `tag Crew as c Captain red, Bosun orange\n\n` + `task A 1`
    );
    ok(parsed);
    const g = parsed.tagGroups[0];
    expect(g.entries.map((e) => e.value)).toEqual(['Captain', 'Bosun']);
  });
});

describe('PERT tag application via pipe metadata', () => {
  it('alias resolves to canonical group name (lowercased)', () => {
    const parsed = parsePert(
      `pert\n` +
        `tag Crew as c\n  Captain red\n  Bosun orange\n\n` +
        `task A 1 c: Captain`
    );
    ok(parsed);
    const a = parsed.activities.find((x) => x.name === 'task A')!;
    expect(a.tags?.crew).toBe('Captain');
  });

  it('reserved keys (`confidence`, `collapsed`) do not bleed into tags', () => {
    const parsed = parsePert(
      `pert\ndefault-confidence medium\n` +
        `tag Crew as c\n  Captain red\n\n` +
        `task A 1 2 4 confidence: low, c: Captain`
    );
    ok(parsed);
    const a = parsed.activities.find((x) => x.name === 'task A')!;
    expect(a.confidence).toBe('low');
    expect(a.tags).toEqual({ crew: 'Captain' });
  });

  it('default value is injected on activities that lack the key', () => {
    const parsed = parsePert(
      `pert\n` +
        `tag Risk as r\n  Safe green\n  Critical red\n\n` +
        `task A 1\n` +
        `task B 1 r: Critical`
    );
    ok(parsed);
    const a = parsed.activities.find((x) => x.name === 'task A')!;
    const b = parsed.activities.find((x) => x.name === 'task B')!;
    expect(a.tags?.risk).toBe('Safe');
    expect(b.tags?.risk).toBe('Critical');
  });

  it('group headers also accept tag aliases', () => {
    const parsed = parsePert(
      `pert\n` +
        `tag Crew as c\n  Captain red\n  Bosun orange\n\n` +
        `[outfit ship] c: Bosun\n` +
        `  task A 1`
    );
    ok(parsed);
    const g = parsed.groups[0];
    expect(g.tags?.crew).toBe('Bosun');
  });

  it('warns on unknown tag value', () => {
    const parsed = parsePert(
      `pert\n` +
        `tag Risk as r\n  Safe green\n  Critical red\n\n` +
        `task A 1 r: Bananas`
    );
    const warn = parsed.diagnostics.find(
      (d) =>
        d.severity === 'warning' &&
        d.message.includes("Unknown value 'Bananas'")
    );
    expect(warn).toBeDefined();
  });
});

describe('PERT active-tag directive', () => {
  it('stores the directive value on options.activeTag', () => {
    const parsed = parsePert(
      `pert\nactive-tag Crew\n` +
        `tag Crew as c\n  Captain red\n\n` +
        `task A 1 c: Captain`
    );
    ok(parsed);
    expect(parsed.options.activeTag).toBe('Crew');
  });

  it('omitting active-tag leaves options.activeTag undefined', () => {
    const parsed = parsePert(
      `pert\n` + `tag Crew as c\n  Captain red\n\n` + `task A 1 c: Captain`
    );
    ok(parsed);
    expect(parsed.options.activeTag).toBeUndefined();
  });

  it('active-tag none is preserved verbatim', () => {
    const parsed = parsePert(
      `pert\nactive-tag none\n` +
        `tag Crew as c\n  Captain red\n\n` +
        `task A 1`
    );
    ok(parsed);
    expect(parsed.options.activeTag).toBe('none');
  });
});

describe('PERT tag rendering', () => {
  function render(src: string): string {
    return renderPertForExport(src, 'light', PALETTE as never);
  }

  it('emits data-tag-* attributes on activity nodes', () => {
    const svg = render(
      `pert\n` +
        `tag Crew as c\n  Captain red\n  Bosun orange\n\n` +
        `task A 1 2 4 c: Captain\n` +
        `task B 1 2 4 c: Bosun`
    );
    expect(svg).toContain('data-tag-crew="captain"');
    expect(svg).toContain('data-tag-crew="bosun"');
  });

  it('renders a tag legend container when groups are declared', () => {
    const svg = render(
      `pert\n` + `tag Crew as c\n  Captain red\n  Bosun orange\n\n` + `task A 1`
    );
    expect(svg).toContain('pert-tag-legend');
    expect(svg).toContain('data-legend-group="crew"');
  });

  it('no `active-tag` directive → auto-activates first declared group', () => {
    // Without an explicit directive, resolveActiveTagGroup auto-activates
    // the first declared tag group → coloring is on by default. Use
    // `active-tag none` to opt out.
    const svgImplicit = render(
      `pert\n` +
        `tag Crew as c\n  Captain red\n  Bosun orange\n\n` +
        `task A 1 2 4 c: Captain`
    );
    const svgExplicit = render(
      `pert\nactive-tag Crew\n` +
        `tag Crew as c\n  Captain red\n  Bosun orange\n\n` +
        `task A 1 2 4 c: Captain`
    );
    const svgOptOut = render(
      `pert\nactive-tag none\n` +
        `tag Crew as c\n  Captain red\n  Bosun orange\n\n` +
        `task A 1 2 4 c: Captain`
    );
    expect(svgImplicit).toContain('data-legend-active="crew"');
    expect(svgExplicit).toContain('data-legend-active="crew"');
    expect(svgOptOut).not.toContain('data-legend-active="crew"');
  });

  it('milestone activity gets a data-tag attribute too', () => {
    const svg = render(
      `pert\n` +
        `tag Crew as c\n  Captain red\n\n` +
        `voyage approved 0 c: Captain\n` +
        `  -> task A\n` +
        `task A 1`
    );
    expect(svg).toContain('data-tag-crew="captain"');
  });
});

describe('PERT tag analyzer pass-through', () => {
  it('analyzer carries tagGroups from parsed → resolved', () => {
    const parsed = parsePert(
      `pert\n` +
        `tag Crew as c\n  Captain red\n  Bosun orange\n\n` +
        `task A 1 c: Captain`
    );
    ok(parsed);
    const resolved = analyzePert(parsed);
    expect(resolved.tagGroups).toHaveLength(1);
    expect(resolved.tagGroups[0].name).toBe('Crew');
  });
});
