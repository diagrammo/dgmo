// #2293: the HTML serializer writes U+00A0 as `&nbsp;`, which is not an XML
// entity, so the SVG→PNG parser rejected any diagram with a nbsp in a label
// (de-DE `format percent` emits one).
import { describe, expect, it } from 'vitest';

import { render } from '../src/index';
import { serializeSvg } from '../src/utils/svg-serialize';

function xmlError(svg: string): string | null {
  const doc = new DOMParser().parseFromString(svg, 'application/xml');
  const err = doc.querySelector('parsererror');
  return err ? (err.textContent ?? 'parse error') : null;
}

describe('serializeSvg U+00A0', () => {
  it('emits no &nbsp; for text nodes and attributes', () => {
    const doc = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"><text data-x="a\u00a0b">5\u00a0%</text></svg>',
      'image/svg+xml'
    );
    const out = serializeSvg(doc.documentElement);
    expect(out).not.toContain('&nbsp;');
    expect(xmlError(out)).toBeNull();
  });

  const CASES: Record<string, string> = {
    'bar de-DE percent':
      'bar\nlocale de-DE\nformat percent\n  A 0.5\n  B 0.25\n',
    'pie de-DE percent':
      'pie\nlocale de-DE\nformat percent\n  A 0.5\n  B 0.25\n',
    'label with U+00A0': 'bar\n  A B 10\n  C 20\n',
  };
  for (const [name, src] of Object.entries(CASES)) {
    it(`${name} renders well-formed XML`, async () => {
      const { svg } = await render(src);
      expect(svg).not.toContain('&nbsp;');
      expect(xmlError(svg)).toBeNull();
    });
  }
});
