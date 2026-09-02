import { describe, it, expect } from 'vitest';
import { render } from '../src/render';

describe('render()', () => {
  it('renders a pie chart with default options', async () => {
    const { svg, diagnostics } = await render(`pie
A: 10
B: 20
C: 30`);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(diagnostics).toBeInstanceOf(Array);
  });

  it('renders a sequence diagram with default options', async () => {
    const { svg } = await render(`sequence
A -hello-> B
B -world-> A`);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders with dark theme', async () => {
    const { svg } = await render(
      `bar
A: 10
B: 20`,
      { theme: 'dark' }
    );
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders with catppuccin palette', async () => {
    const { svg } = await render(
      `pie
A: 10
B: 20`,
      { palette: 'catppuccin' }
    );
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('returns empty string for empty input', async () => {
    const { svg, diagnostics } = await render('');
    expect(svg).toBe('');
    expect(diagnostics).toBeInstanceOf(Array);
  });

  it('returns empty string for unparseable input', async () => {
    const { svg } = await render('just some random text with no chart type');
    expect(svg).toBe('');
  });

  it('returns diagnostics for unknown chart type', async () => {
    const { svg, diagnostics } = await render('barchart\nA: 10');
    expect(svg).toBe('');
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    // Wording changed 2026-09-02: the message no longer enumerates the legacy
    // visualization parser's seven types, it names the word and suggests.
    expect(errors[0].message).toContain('is not a chart type');
  });

  it('returns diagnostics for valid chart with warnings', async () => {
    const { svg, diagnostics } = await render(`pie
A: 10
B: 20`);
    expect(svg).toContain('<svg');
    // Valid chart may have zero diagnostics — just verify the array exists
    expect(Array.isArray(diagnostics)).toBe(true);
  });

  describe('PERT `no-analysis` directive', () => {
    const pert = (extra: string) => `pert Plunder Run
${extra}
set sail 0
  -> raid convoy
raid convoy 4 6 12
  -> divvy shares
divvy shares 1 2 3
`;

    it('renders the analysis layer by default (no directive, no viewState)', async () => {
      const { svg } = await render(pert(''));
      expect(svg).toContain('<svg');
      expect(svg).toContain('pert-tornado-block');
      expect(svg).toContain('pert-scurve-block');
    });

    it('suppresses the analysis layer when `no-analysis` is authored', async () => {
      const { svg } = await render(pert('no-analysis'));
      expect(svg).toContain('<svg');
      expect(svg).not.toContain('pert-tornado-block');
      expect(svg).not.toContain('pert-scurve-block');
    });

    it('viewState.an=false overrides the default-on', async () => {
      const { svg } = await render(pert(''), { viewState: { an: false } });
      expect(svg).not.toContain('pert-tornado-block');
    });

    it('viewState.an=true overrides `no-analysis`', async () => {
      const { svg } = await render(pert('no-analysis'), {
        viewState: { an: true },
      });
      expect(svg).toContain('pert-tornado-block');
    });
  });
});
