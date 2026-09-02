import { describe, it, expect } from 'vitest';
import {
  renderDgmoBlock,
  buildDgmoBlockHtml,
  errorBlockHtml,
  BLOCK_CSS,
} from '../src/embed';
import { loadMapData } from '../src/map/load-data';
import {
  LIGHT_ROLE_STYLES,
  NORD_ROLE_STYLES,
} from '../src/editor/highlight-api';

const PIE = `pie Crew Roles
Sailors 45
Gunners 20
Officers 8`;

describe('renderDgmoBlock — standard embed block', () => {
  it('diagram mode (default): dual-render figure, no source chrome', async () => {
    const { html, diagnostics } = await renderDgmoBlock(PIE);
    expect(html).toMatch(/^<figure class="dgmo dgmo--diagram">/);
    expect(html).toContain('class="dgmo-light"');
    expect(html).toContain('class="dgmo-dark"');
    expect(html).not.toContain('dgmo-source-wrap');
    expect(html).not.toContain('dgmo-toolbar');
    expect(diagnostics).toEqual([]);
  });

  // Issue 507: two of the five framework wrappers make the consumer import
  // the color-mode stylesheet by hand, so a forgotten import rendered the
  // SAME diagram twice, stacked. `hidden` is user-agent origin, so this is a
  // floor rather than a lock — every author rule below still overrides it.
  it('dual-render: the dark wrapper is `hidden`, so a page with no stylesheet shows one diagram', async () => {
    const { html } = await renderDgmoBlock(PIE);
    expect(html).toContain('class="dgmo-dark"');
    expect(html).toMatch(/<div class="dgmo-dark"[^>]*\shidden>/);
    // the light wrapper is never hidden — it IS the no-stylesheet default
    expect(html).not.toMatch(/<div class="dgmo-light"[^>]*\shidden>/);
  });

  it('single-mode render carries no `hidden` — there is nothing to hide', async () => {
    for (const colorMode of ['light', 'dark'] as const) {
      const { html } = await renderDgmoBlock(PIE, { colorMode });
      expect(html).toContain('class="dgmo-svg"');
      expect(html).not.toMatch(/<div class="dgmo-svg"[^>]*\shidden>/);
    }
  });

  it('showcase mode: toolbar-in-summary with toggle, copy, open icons', async () => {
    const { html } = await renderDgmoBlock(PIE, { mode: 'showcase' });
    expect(html).toMatch(/^<figure class="dgmo dgmo--showcase">/);
    // details/summary disclosure: zero-JS toggle
    expect(html).toContain('<details class="dgmo-source-wrap">');
    expect(html).toContain(
      '<summary class="dgmo-toolbar" aria-label="View DGMO source">'
    );
    // </> toggle is NOT a .dgmo-toolbar-btn (client handlers preventDefault
    // on toolbar-btns inside summaries; the toggle needs the default action)
    expect(html).toContain('<span class="dgmo-toggle"');
    expect(html).not.toContain('dgmo-toolbar-btn dgmo-toggle');
    // wordless icon buttons
    expect(html).toContain('class="dgmo-toolbar-btn dgmo-copy"');
    expect(html).toContain('class="dgmo-toolbar-btn dgmo-open"');
    expect(html).not.toContain('>source<');
    expect(html).not.toContain('dgmo-chevron');
    // copy payload
    expect(html).toContain('data-dgmo-source="pie Crew Roles');
    // editor link points at the hosted editor
    expect(html).toMatch(/href="https:\/\/online\.diagrammo\.app\?[^"]+"/);
    // source panel with class-based token highlighting
    expect(html).toContain('<div class="dgmo-source-inner">');
    expect(html).toContain('<pre class="dgmo-pre"><span class="dgmo-code">');
    expect(html).toContain('class="dgmo-tok-chartType"');
  });

  it('no native title attribute anywhere — hover names ride aria-label', async () => {
    // A `title` attr fires the OS tooltip on top of host tooltip systems
    // (Obsidian tooltips aria-label), showing two labels with different text
    // that lag the pointer. UI convention: never a native title tooltip.
    const { html } = await renderDgmoBlock(PIE, { mode: 'showcase' });
    expect(html).not.toMatch(/ title="/);
  });

  it('single colorMode renders one .dgmo-svg wrapper', async () => {
    const { html } = await renderDgmoBlock(PIE, { colorMode: 'light' });
    expect(html).toContain('class="dgmo-svg"');
    expect(html).not.toContain('dgmo-light');
    expect(html).not.toContain('dgmo-dark');
  });

  it('transparent colorMode is a valid single-render', async () => {
    const { html } = await renderDgmoBlock(PIE, { colorMode: 'transparent' });
    expect(html).toContain('class="dgmo-svg"');
    expect(html).toContain('<svg');
  });

  it('title becomes an escaped aria-label, never a visible caption', async () => {
    const { html } = await renderDgmoBlock(PIE, {
      mode: 'showcase',
      title: 'Crew <split> & shares',
    });
    expect(html).toContain('aria-label="Crew &lt;split&gt; &amp; shares"');
    expect(html).not.toContain('dgmo-caption');
    expect(html).not.toContain('<figcaption');
  });

  it('div wrapper + custom class + legacy classes', async () => {
    const { html } = await renderDgmoBlock(PIE, {
      wrapper: 'div',
      className: 'dgmo',
      legacyClassNames: ['astro-dgmo'],
      title: 'cap',
    });
    expect(html).toMatch(
      /^<div class="dgmo dgmo--diagram astro-dgmo" aria-label="cap">/
    );
    expect(html).toContain('class="dgmo-light astro-dgmo"');
    expect(html).not.toContain('dgmo-caption');
  });

  it('each toolbar button toggles independently', async () => {
    // showSource off but the other buttons on: toolbar survives as a plain
    // <div> overlay (no <details>/<summary>, no source panel, no toggle).
    const noSource = await renderDgmoBlock(PIE, {
      mode: 'showcase',
      showSource: false,
    });
    expect(noSource.html).toContain('<div class="dgmo-source-wrap">');
    expect(noSource.html).toContain('<div class="dgmo-toolbar">');
    expect(noSource.html).not.toContain('<details');
    expect(noSource.html).not.toContain('<summary');
    expect(noSource.html).not.toContain('dgmo-toggle');
    expect(noSource.html).not.toContain('dgmo-source-inner');
    expect(noSource.html).toContain('dgmo-copy');
    expect(noSource.html).toContain('dgmo-expand');
    expect(noSource.html).toContain('dgmo-open');

    // showCopy/showOpenInEditor off, source view on: <details> stays.
    const noExtras = await renderDgmoBlock(PIE, {
      mode: 'showcase',
      showCopy: false,
      showOpenInEditor: false,
    });
    expect(noExtras.html).toContain('<details class="dgmo-source-wrap">');
    expect(noExtras.html).not.toContain('dgmo-copy');
    expect(noExtras.html).not.toContain('dgmo-open');
    expect(noExtras.html).toContain('dgmo-toggle');
    expect(noExtras.html).toContain('dgmo-expand');

    // expand off on its own.
    const noExpand = await renderDgmoBlock(PIE, {
      mode: 'showcase',
      showExpand: false,
    });
    expect(noExpand.html).not.toContain('dgmo-expand');
    expect(noExpand.html).toContain('dgmo-copy');

    // every button off: no toolbar at all, even in showcase mode.
    const bare = await renderDgmoBlock(PIE, {
      mode: 'showcase',
      showSource: false,
      showCopy: false,
      showExpand: false,
      showOpenInEditor: false,
    });
    expect(bare.html).not.toContain('dgmo-source-wrap');
    expect(bare.html).not.toContain('dgmo-toolbar');

    // a single button explicitly on in diagram mode (all default off).
    const copyOnly = await renderDgmoBlock(PIE, { showCopy: true });
    expect(copyOnly.html).toContain('dgmo-toolbar');
    expect(copyOnly.html).toContain('dgmo-copy');
    expect(copyOnly.html).not.toContain('dgmo-toggle');
    expect(copyOnly.html).not.toContain('dgmo-open');
  });

  it('unknown palette warns via onWarn and falls back', async () => {
    const warnings: string[] = [];
    const { html } = await renderDgmoBlock(PIE, {
      palette: 'not-a-palette',
      onWarn: (m) => warnings.push(m),
    });
    expect(html).toContain('<svg');
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('dataAttributes — a marker hook for host client code', () => {
  it('emits data-* pairs on the wrapper, escaped', async () => {
    const { html } = await renderDgmoBlock(PIE, {
      dataAttributes: { 'dgmo-ref': 'dgm_01H"x', 'dgmo-ref-updated': '1234' },
    });
    expect(html).toContain('data-dgmo-ref="dgm_01H&quot;x"');
    expect(html).toContain('data-dgmo-ref-updated="1234"');
  });

  it('drops a key that is not an attribute name rather than escaping it', async () => {
    // The value is escaped but the NAME lands in markup verbatim, so a key
    // carrying a quote could close the attribute and open another one.
    const { html } = await renderDgmoBlock(PIE, {
      dataAttributes: { 'x" onload="alert(1)': 'y', '': 'z', OK: 'v' },
    });
    expect(html).not.toContain('onload');
    expect(html).not.toContain('data-OK');
  });

  it('changes nothing when absent', async () => {
    const withEmpty = await renderDgmoBlock(PIE, { dataAttributes: {} });
    const without = await renderDgmoBlock(PIE);
    expect(withEmpty.html).toBe(without.html);
  });
});

describe('buildDgmoBlockHtml — markup-only assembly', () => {
  it('wraps pre-rendered svg divs in the standard chrome', () => {
    const html = buildDgmoBlockHtml(
      PIE,
      '<div class="dgmo-svg"><svg></svg></div>',
      { mode: 'showcase' }
    );
    expect(html).toMatch(/^<figure class="dgmo dgmo--showcase">/);
    expect(html).toContain('<div class="dgmo-svg"><svg></svg></div>');
    expect(html).toContain('dgmo-source-wrap');
  });
});

describe('renderDgmoBlock — invalid source bakes the error card', () => {
  const BAD = `piechart Quarterly Revenue
  Q1 40
  Q2 30`;

  it('substitutes the friendly error card instead of an empty div', async () => {
    const { html, diagnostics } = await renderDgmoBlock(BAD);
    // Regression: the low-level renderer returns an empty SVG on error, which
    // used to leave `.dgmo-light`/`.dgmo-dark` empty (a blank box). The block
    // must fall through to the shared error card.
    expect(html).not.toContain('<div class="dgmo-light"></div>');
    expect(html).toContain("Couldn't render this diagram");
    // Wording changed 2026-09-02: the message no longer enumerates the legacy
    // visualization parser's seven types, it names the word and suggests.
    expect(html).toContain('is not a chart type');
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('renders the error card for a single (non-auto) color mode too', async () => {
    const { html } = await renderDgmoBlock(BAD, { colorMode: 'light' });
    expect(html).toContain('class="dgmo-svg"');
    expect(html).not.toContain('<div class="dgmo-svg"></div>');
    expect(html).toContain("Couldn't render this diagram");
  });

  it('does not crash when a palette id string is passed', async () => {
    // render() must accept a palette-id string (not just a PaletteConfig);
    // the error path indexes palette.light/.dark and used to throw on a string.
    const { html } = await renderDgmoBlock(BAD, { palette: 'nord' });
    expect(html).toContain("Couldn't render this diagram");
  });
});

describe('renderDgmoBlock — a map fence needs its basemap data handed over', () => {
  // The one-line map used across the map suite: a POI resolved by name, which
  // needs the gazetteer, so it cannot accidentally pass without real assets.
  const MAP = `map Port Calls

poi Denver`;

  it('does not drag the Node loader into this browser-loaded entry', async () => {
    // `/block` is dynamically imported in the reader's browser (the custom
    // element, remark-dgmo's opt-in re-render). `loadMapData`'s module carries
    // `import('fs/promises')`, so re-exporting it from here — however
    // convenient for a Node host — would put an unresolvable builtin into
    // every browser bundle of this entry.
    const entry = await import('../src/embed');
    expect('loadMapData' in entry).toBe(false);
  });

  it('bakes the error card when the host supplies no mapData', async () => {
    // Not a defect in the fence — the block reads nothing from disk on its own.
    // Pinned because this is what every wrapper emitted until the option
    // existed, and a future "helpful" environment default would break the
    // browser hosts that share this module.
    const { html, diagnostics } = await renderDgmoBlock(MAP);
    expect(html).toContain("Couldn't render this diagram");
    expect(html).toContain('no basemap data');
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('renders the map when the host passes the loader', async () => {
    const { html, diagnostics } = await renderDgmoBlock(MAP, {
      mapData: loadMapData,
    });
    expect(html).not.toContain("Couldn't render this diagram");
    expect(html).not.toContain('no basemap data');
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(false);
    // A real basemap, not an empty frame: Denver's label resolved off the
    // gazetteer, and the projection drew boundaries. A floor rather than a
    // measurement — the count moves with the basemap's own detail, and what
    // this asserts is only that geography was drawn at all.
    expect(html).toContain('Denver');
    expect(html.match(/<path/g)?.length ?? 0).toBeGreaterThan(20);
  });

  it('accepts already-loaded data, not only a loader', async () => {
    // The browser hosts of this module take the second shape — they bundle or
    // fetch the assets rather than reading them off a disk they do not have.
    const data = await loadMapData();
    const { html } = await renderDgmoBlock(MAP, { mapData: data });
    expect(html).not.toContain('no basemap data');
    expect(html).toContain('Denver');
  });
});

describe('errorBlockHtml — standard error card', () => {
  it('escapes message and source, carries role=alert', () => {
    const html = errorBlockHtml(new Error('boom <b>'), 'pie <bad>');
    expect(html).toMatch(/^<div class="dgmo dgmo--error" role="alert">/);
    expect(html).toContain('dgmo render error:');
    expect(html).toContain('boom &lt;b&gt;');
    expect(html).toContain('<pre>pie &lt;bad&gt;</pre>');
  });

  it('non-Error input gets the generic message + legacy classes', () => {
    const html = errorBlockHtml('nope', 'src', {
      legacyClassNames: ['astro-dgmo'],
    });
    expect(html).toContain('class="dgmo astro-dgmo dgmo--error"');
    expect(html).toContain('Failed to render dgmo block.');
  });

  it('always carries a docs link, chart-type-aware', () => {
    const typed = errorBlockHtml(new Error('boom'), 'gantt Launch\nbad');
    expect(typed).toContain(
      '<a class="dgmo-error-docs" href="https://diagrammo.app/docs/chart-gantt/"'
    );
    expect(typed).toContain('Read the gantt guide ↗');

    const untyped = errorBlockHtml(new Error('boom'), '@@@');
    expect(untyped).toContain('href="https://diagrammo.app/docs/"');
    expect(untyped).toContain('Browse the DGMO docs ↗');
  });
});

describe('BLOCK_CSS — color-mode visibility (issue 507)', () => {
  it('keys dark on both host conventions, so Tailwind and Starlight sites toggle', () => {
    expect(BLOCK_CSS).toContain('[data-theme="dark"] .dgmo-light');
    expect(BLOCK_CSS).toContain('[data-theme="dark"] .dgmo-dark');
    expect(BLOCK_CSS).toContain('html.dark .dgmo-light');
    expect(BLOCK_CSS).toContain('html.dark .dgmo-dark');
  });

  // `auto/styles.ts` re-scopes the `[data-theme="dark"]` rules onto
  // `.dgmo-theme-dark` with a regex that swallows everything up to the `{`,
  // and the wrapper build-css adapters rewrite the same substring by literal
  // replace. Folding the two conventions into one multi-selector rule would
  // drag `html.dark` through both transforms.
  it('keeps the two conventions in separate rule blocks', () => {
    const rules = BLOCK_CSS.match(/\[data-theme="dark"\][^{]*\{/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule).not.toContain('html.dark');
  });
});

describe('BLOCK_CSS ↔ role-style parity (drift guard)', () => {
  const camelToKebab = (s: string) =>
    s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

  /** Extract normalized declarations for a selector from BLOCK_CSS. */
  function cssDecls(selector: string): Record<string, string> {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`);
    const m = BLOCK_CSS.match(re);
    if (!m) return {};
    const decls: Record<string, string> = {};
    for (const line of m[1].split(';')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      decls[line.slice(0, idx).trim()] = line
        .slice(idx + 1)
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
    }
    return decls;
  }

  function expectParity(
    styles: Record<string, Record<string, string>>,
    selectorFor: (role: string) => string
  ): void {
    for (const [role, style] of Object.entries(styles)) {
      if (role === 'default') continue;
      const decls = cssDecls(selectorFor(role));
      expect(Object.keys(decls).length, `missing rule for ${role}`).toBe(
        Object.keys(style).length
      );
      for (const [prop, value] of Object.entries(style)) {
        expect(decls[camelToKebab(prop)], `${role}.${prop}`).toBe(
          value.toLowerCase()
        );
      }
    }
  }

  it('LIGHT_ROLE_STYLES and NORD_ROLE_STYLES share the same role keys', () => {
    expect(Object.keys(LIGHT_ROLE_STYLES).sort()).toEqual(
      Object.keys(NORD_ROLE_STYLES).sort()
    );
  });

  it('light rules mirror LIGHT_ROLE_STYLES', () => {
    expectParity(LIGHT_ROLE_STYLES, (role) => `.dgmo-tok-${role}`);
  });

  it('dark rules mirror NORD_ROLE_STYLES', () => {
    expectParity(
      NORD_ROLE_STYLES,
      (role) => `[data-theme="dark"] .dgmo-tok-${role}`
    );
  });
});
