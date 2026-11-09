// Radar axis names stay on the canvas (#1764): a long name wraps at word
// breaks into at most three lines, the last ellipsized with the full name in a
// hover <title>; short names draw exactly as before.
import { describe, it, expect } from 'vitest';
import { render } from '../src/render';
import { lintSvg } from './stress/lint';

const LONG = `radar Promotion Rubric
Technical judgement on ambiguous problems with incomplete information 4
Raising the quality bar of other teams' designs through review 3
Communicating risk and trade-offs to non-technical stakeholders 4
Mentoring senior engineers toward independent ownership of systems 2
Driving cross-organisation initiatives without direct authority 3
Operational excellence during incidents and in their follow-up work 5`;

const NAME =
  'An axis name so long that even three wrapped lines cannot hold it beside the radar, so its last line ends in an ellipsis and the full name moves into a hover title';
// Second row: the right-hand axis, where the room is the gap to the edge.
const OVERLONG = `radar Overlong
Speed 3
${NAME} 4
Armor 5
Range 2`;

const SHORT = `radar Ship Combat Rating
Firepower       85
Speed           70
Armor           60
Maneuverability 90
Crew Morale     75`;

const draw = async (src: string) =>
  (await render(src, { theme: 'light', palette: 'nord' })).svg;

function axisTexts(svg: string): Element[] {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  return Array.from(doc.querySelectorAll('text')).filter(
    (t) => t.getAttribute('font-size') === '14'
  );
}

describe('radar axis names', () => {
  it('wraps long names so none runs past the canvas', async () => {
    const svg = await draw(LONG);
    expect(lintSvg(svg).filter((f) => f.rule === 'text-outside')).toEqual([]);
    const wrapped = axisTexts(svg).filter(
      (t) => t.querySelectorAll('tspan').length > 1
    );
    expect(wrapped.length).toBeGreaterThan(0);
  });

  it('ellipsizes a name three lines cannot hold and keeps it whole in a <title>', async () => {
    const svg = await draw(OVERLONG);
    expect(lintSvg(svg).filter((f) => f.rule === 'text-outside')).toEqual([]);
    const t = axisTexts(svg).find((el) => el.querySelector('title'));
    expect(t).toBeDefined();
    const spans = Array.from(t!.querySelectorAll('tspan'));
    expect(spans.length).toBe(3);
    expect(spans[2]!.textContent).toMatch(/…$/);
    expect(t!.querySelector('title')!.textContent).toBe(NAME);
  });

  it('draws short names on one line with no tspan or title', async () => {
    const svg = await draw(SHORT);
    const texts = axisTexts(svg);
    expect(texts.map((t) => t.textContent)).toEqual([
      'Firepower',
      'Speed',
      'Armor',
      'Maneuverability',
      'Crew Morale',
    ]);
    for (const t of texts) {
      expect(t.querySelector('tspan')).toBeNull();
      expect(t.querySelector('title')).toBeNull();
    }
  });
});
