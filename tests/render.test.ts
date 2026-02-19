import { describe, it, expect } from 'vitest';
import { render } from '../src/render';

describe('render()', () => {
  it('renders a pie chart with default options', async () => {
    const svg = await render(`chart: pie
A: 10
B: 20
C: 30`);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders a sequence diagram with default options', async () => {
    const svg = await render(`chart: sequence
A -> B: hello
B -> A: world`);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders with dark theme', async () => {
    const svg = await render(
      `chart: bar
A: 10
B: 20`,
      { theme: 'dark' },
    );
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders with catppuccin palette', async () => {
    const svg = await render(
      `chart: pie
A: 10
B: 20`,
      { palette: 'catppuccin' },
    );
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('returns empty string for empty input', async () => {
    const svg = await render('');
    expect(svg).toBe('');
  });

  it('returns empty string for unparseable input', async () => {
    const svg = await render('just some random text with no chart type');
    expect(svg).toBe('');
  });
});
