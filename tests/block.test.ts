import { describe, it, expect } from 'vitest';
import {
  renderDgmoBlock,
  buildDgmoBlockHtml,
  errorBlockHtml,
  BLOCK_CSS,
} from '../src/block';
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

  it('showSource/showCopy/showOpenInEditor toggles', async () => {
    const noSource = await renderDgmoBlock(PIE, {
      mode: 'showcase',
      showSource: false,
    });
    expect(noSource.html).not.toContain('dgmo-source-wrap');

    const noExtras = await renderDgmoBlock(PIE, {
      mode: 'showcase',
      showCopy: false,
      showOpenInEditor: false,
    });
    expect(noExtras.html).toContain('dgmo-source-wrap');
    expect(noExtras.html).not.toContain('dgmo-copy');
    expect(noExtras.html).not.toContain('dgmo-open');
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
