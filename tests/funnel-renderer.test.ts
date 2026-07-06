import { describe, it, expect } from 'vitest';
import { render } from '../src/render';

const SRC = [
  'funnel Pirate Recruitment Pipeline',
  'Port Visitors blue 1000',
  'Tavern Recruits cyan 500',
  'Crew Trials yellow 200',
].join('\n');

describe('funnel renderer labels', () => {
  it('renders name left, value + conversion % right, no leader lines', async () => {
    const { svg } = await render(SRC);
    expect(svg).toContain('Port Visitors');
    expect(svg).toContain('1,000');
    // conversion % of the two follow-up stages
    expect(svg).toContain('50%');
    expect(svg).toContain('40%');
    // first stage carries no % (nothing to convert from)
    expect(svg).not.toContain('100%');
    // leader lines are gone — the only <line> elements allowed are none
    expect(svg).not.toContain('<line');
  });

  it('colors each stage label with its segment color', async () => {
    const { svg } = await render(SRC);
    // segment stroke and its name label share the resolved intent color;
    // assert the label text node is NOT the default text color fill
    const label = svg.match(
      /<text[^>]*fill="([^"]+)"[^>]*>Port Visitors<\/text>/
    );
    expect(label).not.toBeNull();
    const seg = svg.match(/<polygon[^>]*stroke="([^"]+)"/);
    expect(seg).not.toBeNull();
    expect(label![1]).toBe(seg![1]);
  });

  it('no-percent suppresses conversion percentages, keeps values', async () => {
    const { svg } = await render('funnel T\nno-percent\nA 1000\nB 500\nC 200');
    expect(svg).not.toContain('%<');
    expect(svg).toContain('1,000');
    expect(svg).toContain('500');
  });

  it('no-value with percentages shows the % alone', async () => {
    const { svg } = await render('funnel T\nno-value\nA 1000\nB 500');
    expect(svg).toContain('50%');
    // data-value="1,000" hover metadata remains; the rendered text must not
    expect(svg).not.toContain('>1,000<');
  });

  it('in-band value uses the segment color, scaled up', async () => {
    const { svg } = await render(SRC);
    const value = svg.match(
      /<text[^>]*fill="([^"]+)"[^>]*font-size="([^"]+)"[^>]*font-weight="700"[^>]*>1,000<\/text>/
    );
    expect(value).not.toBeNull();
    const seg = svg.match(/<polygon[^>]*stroke="([^"]+)"/);
    expect(value![1]).toBe(seg![1]);
    expect(parseFloat(value![2])).toBeGreaterThan(13);
  });

  it('solid-fill switches the in-band value to contrast text', async () => {
    const { svg } = await render(`funnel T\nsolid-fill\nA 1000\nB 500`);
    const value = svg.match(
      /<text[^>]*fill="([^"]+)"[^>]*font-weight="700"[^>]*>1,000<\/text>/
    );
    expect(value).not.toBeNull();
    const seg = svg.match(/<polygon[^>]*stroke="([^"]+)"/);
    // on a solid band the value must NOT be the band color — it sits on it
    expect(value![1]).not.toBe(seg![1]);
  });
});
