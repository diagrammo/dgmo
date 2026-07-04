import { describe, expect, it } from 'vitest';

import { render } from '../src/render';

// BL-111: the canonical export path (`render()` → exportOrg/exportSitemap in
// d3.ts) must honor the source `hide` directive on its own — not only an
// interactive `viewState.ha`. This is the read half of the org/sitemap `ha`
// sync: what the app writes as `hide <attrs>` must reproduce anywhere.

describe('org: source hide directive honored by render()', () => {
  const src = `org
hide location

Alice
  location: NY
  status: FTE`;

  it('filters the hidden attribute out of exported cards', async () => {
    const { svg } = await render(src, { theme: 'light', palette: 'slate' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('>FTE<'); // status still shown
    expect(svg).not.toContain('>NY<'); // location hidden by source
  });

  it('unions source hide with interactive viewState.ha', async () => {
    const { svg } = await render(src, {
      theme: 'light',
      palette: 'slate',
      viewState: { ha: ['status'] },
    });
    expect(svg).not.toContain('>NY<'); // from source
    expect(svg).not.toContain('>FTE<'); // from viewState.ha
  });
});

describe('sitemap: source hide directive honored by render()', () => {
  it('filters the hidden attribute out of exported cards', async () => {
    const src = `sitemap
hide owner

Home
  owner: Team A
  status: live`;
    const { svg } = await render(src, { theme: 'light', palette: 'slate' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('>live<');
    expect(svg).not.toContain('>Team A<');
  });
});
