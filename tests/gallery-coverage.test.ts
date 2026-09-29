// Every offered chart type has at least one gallery fixture.
//
// `gallery/fixtures` is not only the snapshot suite's input: dgmo-mcp ships it
// as the `get_examples` starter templates, and a type with no fixture answers
// `get_examples('<type>')` with an error (diagrammo/diagrammo#854). The match
// rule below is dgmo-mcp's `isExampleFor` (`dgmo-mcp/src/index.ts`):
// `<type>.dgmo` or `<type>-*.dgmo` at the top level, or anything under a
// `<type>/` directory.

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { chartTypes } from '../src/chart-types';
import { withoutInternalChartTypes } from '../src/utils/offered-types';

const GALLERY_DIR = join(__dirname, '..', 'gallery', 'fixtures');

const names = readdirSync(GALLERY_DIR, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.dgmo'))
  .map((f) => f.split(sep).join('/').slice(0, -'.dgmo'.length));

function hasFixture(type: string): boolean {
  return names.some((name) => {
    const slash = name.indexOf('/');
    if (slash !== -1) return name.slice(0, slash) === type;
    return name === type || name.startsWith(type + '-');
  });
}

describe('gallery coverage', () => {
  it('every offered chart type has a gallery fixture', () => {
    const offered = withoutInternalChartTypes(chartTypes.map((c) => c.id));
    expect(offered.filter((type) => !hasFixture(type))).toEqual([]);
  });
});
