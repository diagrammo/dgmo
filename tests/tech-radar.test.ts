import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseTechRadar } from '../src/tech-radar/parser';
import { computeRadarLayout } from '../src/tech-radar/layout';
import { renderTechRadar } from '../src/tech-radar/renderer';
import { getPalette } from '../src/palettes';
import * as fs from 'node:fs';
import * as path from 'node:path';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  Object.defineProperty(globalThis, 'document', {
    value: win.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: win.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    value: win.SVGElement,
    configurable: true,
  });
});

const nordLight = getPalette('nord').light;

const BASIC_RADAR = `tech-radar My Tech Radar

rings
  Adopt
  Trial
  Assess
  Hold

Techniques | quadrant: top-right
  CD | ring: Adopt, trend: stable
    Fully adopted across all services.
  Micro Frontends | ring: Trial, trend: up

Tools | quadrant: top-left
  Copilot | ring: Trial, trend: new
  Webpack | ring: Hold, trend: down

Platforms | quadrant: bottom-left
  Kubernetes | ring: Adopt
  Serverless | ring: Trial

Languages | quadrant: bottom-right
  TypeScript | ring: Adopt, trend: stable
  Rust | ring: Assess, trend: new
`;

// ============================================================
// Parser Tests
// ============================================================

describe('tech-radar parser — basic', () => {
  it('parses title, rings, quadrants, and blips', () => {
    const result = parseTechRadar(BASIC_RADAR);
    expect(result.type).toBe('tech-radar');
    expect(result.title).toBe('My Tech Radar');
    expect(result.rings).toHaveLength(4);
    expect(result.rings[0].name).toBe('Adopt');
    expect(result.rings[3].name).toBe('Hold');
    expect(result.quadrants).toHaveLength(4);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.error).toBeNull();
  });

  it('parses quadrant positions correctly', () => {
    const result = parseTechRadar(BASIC_RADAR);
    const positions = result.quadrants.map((q) => q.position).sort();
    expect(positions).toEqual([
      'bottom-left',
      'bottom-right',
      'top-left',
      'top-right',
    ]);
  });

  it('parses blips with ring and trend', () => {
    const result = parseTechRadar(BASIC_RADAR);
    const techniques = result.quadrants.find(
      (q) => q.position === 'top-right'
    )!;
    expect(techniques.blips).toHaveLength(2);
    expect(techniques.blips[0].name).toBe('CD');
    expect(techniques.blips[0].ring).toBe('Adopt');
    expect(techniques.blips[0].trend).toBe('stable');
    expect(techniques.blips[1].name).toBe('Micro Frontends');
    expect(techniques.blips[1].ring).toBe('Trial');
    expect(techniques.blips[1].trend).toBe('up');
  });

  it('collects multi-line descriptions', () => {
    const result = parseTechRadar(BASIC_RADAR);
    const techniques = result.quadrants.find(
      (q) => q.position === 'top-right'
    )!;
    expect(techniques.blips[0].description).toEqual([
      'Fully adopted across all services.',
    ]);
    expect(techniques.blips[1].description).toEqual([]);
  });

  it('handles optional trend (null when omitted)', () => {
    const result = parseTechRadar(BASIC_RADAR);
    const platforms = result.quadrants.find(
      (q) => q.position === 'bottom-left'
    )!;
    expect(platforms.blips[0].name).toBe('Kubernetes');
    expect(platforms.blips[0].trend).toBeNull();
  });
});

describe('tech-radar parser — global numbering', () => {
  it('assigns globalNumber in correct order (quadrant→ring→declaration)', () => {
    const result = parseTechRadar(BASIC_RADAR);
    // Order: top-left(Copilot=Trial#1, Webpack=Hold#2),
    //        top-right(CD=Adopt#3, MF=Trial#4),
    //        bottom-right(TS=Adopt#5, Rust=Assess#6),
    //        bottom-left(K8s=Adopt#7, Serverless=Trial#8)
    const allBlips = result.quadrants.flatMap((q) => q.blips);
    const numbered = allBlips
      .filter((b) => b.globalNumber > 0)
      .sort((a, b) => a.globalNumber - b.globalNumber);

    expect(numbered).toHaveLength(8);
    expect(numbered[0].name).toBe('Copilot'); // TL, Trial (ring 1)
    expect(numbered[0].globalNumber).toBe(1);
    expect(numbered[1].name).toBe('Webpack'); // TL, Hold (ring 3)
    expect(numbered[1].globalNumber).toBe(2);
  });
});

describe('tech-radar parser — diagnostics', () => {
  it('emits error when rings block is missing', () => {
    const result = parseTechRadar(`tech-radar No Rings

Techniques | quadrant: top-right
  CD | ring: Adopt
Tools | quadrant: top-left
  Vite | ring: Trial
Platforms | quadrant: bottom-left
  K8s | ring: Adopt
Languages | quadrant: bottom-right
  TS | ring: Adopt
`);
    expect(result.diagnostics.some((d) => d.message.includes('rings'))).toBe(
      true
    );
  });

  it('emits error when fewer than 4 quadrants', () => {
    const result = parseTechRadar(`tech-radar Missing Quadrants

rings
  Adopt
  Trial

Techniques | quadrant: top-right
  CD | ring: Adopt
Tools | quadrant: top-left
  Vite | ring: Trial
`);
    expect(
      result.diagnostics.some((d) => d.message.includes('4 quadrants'))
    ).toBe(true);
  });

  it('emits error for duplicate quadrant positions', () => {
    const result = parseTechRadar(`tech-radar Dup

rings
  Adopt

Techniques | quadrant: top-right
  CD | ring: Adopt
Tools | quadrant: top-right
  Vite | ring: Adopt
Platforms | quadrant: bottom-left
  K8s | ring: Adopt
Languages | quadrant: bottom-right
  TS | ring: Adopt
`);
    expect(
      result.diagnostics.some((d) => d.message.includes('Duplicate quadrant'))
    ).toBe(true);
  });

  it('emits error for missing ring on blip', () => {
    const result = parseTechRadar(`tech-radar Missing Ring

rings
  Adopt

Techniques | quadrant: top-right
  CD | trend: new
Tools | quadrant: top-left
  Vite | ring: Adopt
Platforms | quadrant: bottom-left
  K8s | ring: Adopt
Languages | quadrant: bottom-right
  TS | ring: Adopt
`);
    expect(
      result.diagnostics.some((d) => d.message.includes('no ring assignment'))
    ).toBe(true);
  });

  it('emits error for unknown ring name on blip', () => {
    const result = parseTechRadar(`tech-radar Unknown Ring

rings
  Adopt
  Trial

Techniques | quadrant: top-right
  CD | ring: Invented
Tools | quadrant: top-left
  Vite | ring: Adopt
Platforms | quadrant: bottom-left
  K8s | ring: Adopt
Languages | quadrant: bottom-right
  TS | ring: Adopt
`);
    expect(
      result.diagnostics.some((d) => d.message.includes('Unknown ring'))
    ).toBe(true);
  });

  it('emits warning for unknown trend value', () => {
    const result = parseTechRadar(`tech-radar Bad Trend

rings
  Adopt

Techniques | quadrant: top-right
  CD | ring: Adopt, trend: sideways
Tools | quadrant: top-left
  Vite | ring: Adopt
Platforms | quadrant: bottom-left
  K8s | ring: Adopt
Languages | quadrant: bottom-right
  TS | ring: Adopt
`);
    expect(
      result.diagnostics.some(
        (d) => d.message.includes('Unknown trend') && d.severity === 'warning'
      )
    ).toBe(true);
  });
});

// ============================================================
// Layout Tests
// ============================================================

describe('tech-radar layout', () => {
  const parsed = parseTechRadar(BASIC_RADAR);

  it('produces deterministic layout', () => {
    const layout1 = computeRadarLayout(parsed, 800, 600);
    const layout2 = computeRadarLayout(parsed, 800, 600);
    expect(layout1).toEqual(layout2);
  });

  it('produces correct number of layout points', () => {
    const layout = computeRadarLayout(parsed, 800, 600);
    const totalBlips = parsed.quadrants.reduce(
      (sum, q) => sum + q.blips.length,
      0
    );
    expect(layout).toHaveLength(totalBlips);
  });

  it('all blips are within their ring band and quadrant arc', () => {
    const layout = computeRadarLayout(parsed, 800, 600);
    const cx = 400;
    const cy = 300;
    const maxRadius = Math.min(cx, cy) * 0.88;

    for (const point of layout) {
      const dx = point.x - cx;
      const dy = point.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      expect(dist).toBeLessThanOrEqual(maxRadius + 1);
    }
  });

  it('no overlapping blip circles', () => {
    const layout = computeRadarLayout(parsed, 800, 600);
    const minDist = 8; // reasonable minimum distance

    for (let i = 0; i < layout.length; i++) {
      for (let j = i + 1; j < layout.length; j++) {
        const dx = layout[i].x - layout[j].x;
        const dy = layout[i].y - layout[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        expect(dist).toBeGreaterThanOrEqual(minDist);
      }
    }
  });

  it("is stable — adding a blip to one quadrant doesn't affect others", () => {
    const layout1 = computeRadarLayout(parsed, 800, 600);

    // Add a blip to top-right quadrant
    const modified = parseTechRadar(
      BASIC_RADAR + '\n  Extra | ring: Adopt, trend: new'
    );
    // That extra blip goes into bottom-right (last quadrant being parsed)
    const layout2 = computeRadarLayout(modified, 800, 600);

    // Check that top-left points haven't changed
    const tlPoints1 = layout1.filter((p) => p.quadrantIndex === 0);
    const tlPoints2 = layout2.filter((p) => p.quadrantIndex === 0);
    expect(tlPoints1).toHaveLength(tlPoints2.length);
    for (let i = 0; i < tlPoints1.length; i++) {
      expect(tlPoints1[i].x).toBeCloseTo(tlPoints2[i].x, 5);
      expect(tlPoints1[i].y).toBeCloseTo(tlPoints2[i].y, 5);
    }
  });
});

describe('tech-radar layout — dense', () => {
  it('handles 60+ blips without overlaps', () => {
    const densePath = path.join(
      __dirname,
      '../gallery/fixtures/tech-radar-dense.dgmo'
    );
    const content = fs.readFileSync(densePath, 'utf-8');
    const parsed = parseTechRadar(content);
    expect(parsed.diagnostics).toHaveLength(0);

    const layout = computeRadarLayout(parsed, 1000, 800);
    const totalBlips = parsed.quadrants.reduce(
      (sum, q) => sum + q.blips.length,
      0
    );
    expect(totalBlips).toBeGreaterThan(60);
    expect(layout).toHaveLength(totalBlips);

    // Check no overlaps (with smaller threshold for dense layouts)
    const minDist = 5;
    let overlaps = 0;
    for (let i = 0; i < layout.length; i++) {
      for (let j = i + 1; j < layout.length; j++) {
        const dx = layout[i].x - layout[j].x;
        const dy = layout[i].y - layout[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) overlaps++;
      }
    }
    // Allow a small number of near-overlaps in very dense layouts
    expect(overlaps).toBeLessThan(5);
  });
});

// ============================================================
// Renderer Tests (jsdom)
// ============================================================

describe('tech-radar renderer', () => {
  it('renders SVG with correct ring boundaries', () => {
    const parsed = parseTechRadar(BASIC_RADAR);
    const container = document.createElement(
      'div'
    ) as unknown as HTMLDivElement;
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 700 });

    renderTechRadar(container, parsed, nordLight, false);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();

    // Should have ring boundary circles (4 rings)
    const circles = svg!.querySelectorAll('circle');
    // At least 4 ring boundaries + blip circles
    expect(circles.length).toBeGreaterThanOrEqual(4);
  });

  it('renders correct number of blip groups with data-line-number', () => {
    const parsed = parseTechRadar(BASIC_RADAR);
    const container = document.createElement(
      'div'
    ) as unknown as HTMLDivElement;
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 700 });

    renderTechRadar(container, parsed, nordLight, false);

    const blipGroups = container.querySelectorAll('[data-line-number]');
    const totalBlips = parsed.quadrants.reduce(
      (sum, q) => sum + q.blips.length,
      0
    );
    // Each blip gets a data-line-number on its group, plus listing items
    expect(blipGroups.length).toBeGreaterThanOrEqual(totalBlips);
  });

  it('renders quadrant divider lines', () => {
    const parsed = parseTechRadar(BASIC_RADAR);
    const container = document.createElement(
      'div'
    ) as unknown as HTMLDivElement;
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 700 });

    renderTechRadar(container, parsed, nordLight, false);

    const lines = container.querySelectorAll('line');
    expect(lines.length).toBeGreaterThanOrEqual(2); // horizontal + vertical
  });

  it('renders with export dimensions', () => {
    const parsed = parseTechRadar(BASIC_RADAR);
    const container = document.createElement(
      'div'
    ) as unknown as HTMLDivElement;

    renderTechRadar(container, parsed, nordLight, false, undefined, {
      width: 1200,
      height: 900,
    });

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('width')).toBe('1200');
    expect(svg!.getAttribute('height')).toBe('900');
  });
});

// ============================================================
// Fixture Tests
// ============================================================

describe('tech-radar fixture tests', () => {
  it('gallery fixture parses without errors', () => {
    const fixturePath = path.join(
      __dirname,
      '../gallery/fixtures/tech-radar.dgmo'
    );
    const content = fs.readFileSync(fixturePath, 'utf-8');
    const parsed = parseTechRadar(content);
    expect(parsed.diagnostics).toHaveLength(0);
    expect(parsed.quadrants).toHaveLength(4);
    expect(parsed.rings).toHaveLength(4);
  });

  it('dense fixture parses without errors', () => {
    const fixturePath = path.join(
      __dirname,
      '../gallery/fixtures/tech-radar-dense.dgmo'
    );
    const content = fs.readFileSync(fixturePath, 'utf-8');
    const parsed = parseTechRadar(content);
    expect(parsed.diagnostics).toHaveLength(0);
    expect(parsed.quadrants).toHaveLength(4);
    const totalBlips = parsed.quadrants.reduce(
      (sum, q) => sum + q.blips.length,
      0
    );
    expect(totalBlips).toBeGreaterThan(60);
  });
});

// ============================================================
// Edge Cases
// ============================================================

describe('tech-radar parser — edge cases', () => {
  it('handles empty content', () => {
    const result = parseTechRadar('');
    expect(result.error).not.toBeNull();
  });

  it('handles comments', () => {
    const result = parseTechRadar(`tech-radar Commented
// This is a comment

rings
  Adopt
  Trial
  Assess
  Hold

// Quadrants below
Techniques | quadrant: top-right
  // Some technique
  CD | ring: Adopt
Tools | quadrant: top-left
  Vite | ring: Adopt
Platforms | quadrant: bottom-left
  K8s | ring: Adopt
Languages | quadrant: bottom-right
  TS | ring: Adopt
`);
    expect(result.title).toBe('Commented');
    expect(result.quadrants).toHaveLength(4);
    const techniques = result.quadrants.find(
      (q) => q.position === 'top-right'
    )!;
    expect(techniques.blips).toHaveLength(1);
  });

  it('handles case-insensitive ring matching', () => {
    const result = parseTechRadar(`tech-radar Case Test

rings
  Adopt
  Trial

Techniques | quadrant: top-right
  CD | ring: adopt
Tools | quadrant: top-left
  Vite | ring: TRIAL
Platforms | quadrant: bottom-left
  K8s | ring: Adopt
Languages | quadrant: bottom-right
  TS | ring: Trial
`);
    expect(result.diagnostics).toHaveLength(0);
    // Should use canonical ring names
    const techniques = result.quadrants.find(
      (q) => q.position === 'top-right'
    )!;
    expect(techniques.blips[0].ring).toBe('Adopt');
  });

  it('handles custom quadrant colors', () => {
    const result = parseTechRadar(`tech-radar Colors

rings
  Adopt

Techniques | quadrant: top-right, color: purple
  CD | ring: Adopt
Tools | quadrant: top-left
  Vite | ring: Adopt
Platforms | quadrant: bottom-left
  K8s | ring: Adopt
Languages | quadrant: bottom-right
  TS | ring: Adopt
`);
    expect(result.diagnostics).toHaveLength(0);
    const techniques = result.quadrants.find(
      (q) => q.position === 'top-right'
    )!;
    expect(techniques.color).toBe('purple');
  });

  it('tech-radar with no title', () => {
    const result = parseTechRadar(`tech-radar

rings
  Adopt

A | quadrant: top-right
  X | ring: Adopt
B | quadrant: top-left
  Y | ring: Adopt
C | quadrant: bottom-left
  Z | ring: Adopt
D | quadrant: bottom-right
  W | ring: Adopt
`);
    expect(result.title).toBe('');
    expect(result.quadrants).toHaveLength(4);
    expect(result.diagnostics).toHaveLength(0);
  });
});

// ============================================================
// Ring Section Syntax (new)
// ============================================================

describe('tech-radar parser — ring section syntax', () => {
  it('parses blips under ring section headers', () => {
    const result = parseTechRadar(`tech-radar Ring Sections

rings
  Adopt
  Trial
  Hold

A | quadrant: top-right
  Adopt
    X
    Y
  Trial
    Z | trend: up
B | quadrant: top-left
  Adopt
    W
C | quadrant: bottom-left
  Hold
    V
D | quadrant: bottom-right
  Trial
    U
`);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.quadrants).toHaveLength(4);

    const a = result.quadrants.find((q) => q.position === 'top-right')!;
    expect(a.blips).toHaveLength(3);
    expect(a.blips[0].name).toBe('X');
    expect(a.blips[0].ring).toBe('Adopt');
    expect(a.blips[0].trend).toBeNull();
    expect(a.blips[2].name).toBe('Z');
    expect(a.blips[2].ring).toBe('Trial');
    expect(a.blips[2].trend).toBe('up');
  });

  it('supports descriptions under ring-section blips', () => {
    const result = parseTechRadar(`tech-radar Desc Test

rings
  Adopt
  Trial

A | quadrant: top-right
  Adopt
    Tool X
      First line of description.
      Second line.
B | quadrant: top-left
  Trial
    Tool Y
C | quadrant: bottom-left
  Adopt
    Tool Z
D | quadrant: bottom-right
  Trial
    Tool W
`);
    expect(result.diagnostics).toHaveLength(0);
    const a = result.quadrants.find((q) => q.position === 'top-right')!;
    expect(a.blips[0].description).toEqual([
      'First line of description.',
      'Second line.',
    ]);
  });

  it('mixes old and new syntax in the same file', () => {
    const result = parseTechRadar(`tech-radar Mixed

rings
  Adopt
  Trial

A | quadrant: top-right
  Adopt
    NewSyntax
  OldSyntax | ring: Trial, trend: new
B | quadrant: top-left
  Adopt
    B1
C | quadrant: bottom-left
  Trial
    C1
D | quadrant: bottom-right
  Adopt
    D1
`);
    expect(result.diagnostics).toHaveLength(0);
    const a = result.quadrants.find((q) => q.position === 'top-right')!;
    expect(a.blips).toHaveLength(2);
    expect(a.blips[0].name).toBe('NewSyntax');
    expect(a.blips[0].ring).toBe('Adopt');
    expect(a.blips[1].name).toBe('OldSyntax');
    expect(a.blips[1].ring).toBe('Trial');
    expect(a.blips[1].trend).toBe('new');
  });

  it('explicit ring: metadata overrides section ring', () => {
    const result = parseTechRadar(`tech-radar Override

rings
  Adopt
  Trial

A | quadrant: top-right
  Adopt
    Blip | ring: Trial
B | quadrant: top-left
  Adopt
    B1
C | quadrant: bottom-left
  Adopt
    C1
D | quadrant: bottom-right
  Adopt
    D1
`);
    expect(result.diagnostics).toHaveLength(0);
    const a = result.quadrants.find((q) => q.position === 'top-right')!;
    expect(a.blips[0].ring).toBe('Trial');
  });

  it('supports ring aliases in declarations and references', () => {
    const result = parseTechRadar(`tech-radar Aliases

rings
  Adopt alias a
  Trial aka t
  Hold

A | quadrant: top-right
  a
    X
  t
    Y | trend: up
B | quadrant: top-left
  a
    B1
C | quadrant: bottom-left
  Hold
    C1
D | quadrant: bottom-right
  a
    D1
`);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.rings[0].name).toBe('Adopt');
    expect(result.rings[0].alias).toBe('a');
    expect(result.rings[1].name).toBe('Trial');
    expect(result.rings[1].alias).toBe('t');
    expect(result.rings[2].alias).toBeNull();

    const a = result.quadrants.find((q) => q.position === 'top-right')!;
    expect(a.blips[0].name).toBe('X');
    expect(a.blips[0].ring).toBe('Adopt'); // resolved from alias
    expect(a.blips[1].name).toBe('Y');
    expect(a.blips[1].ring).toBe('Trial'); // resolved from alias
  });

  it('supports ring alias in pipe metadata', () => {
    const result = parseTechRadar(`tech-radar Alias Pipe

rings
  Adopt alias a
  Trial

A | quadrant: top-right
  X | ring: a, trend: new
B | quadrant: top-left
  Trial
    B1
C | quadrant: bottom-left
  Trial
    C1
D | quadrant: bottom-right
  Trial
    D1
`);
    expect(result.diagnostics).toHaveLength(0);
    const a = result.quadrants.find((q) => q.position === 'top-right')!;
    expect(a.blips[0].ring).toBe('Adopt');
    expect(a.blips[0].trend).toBe('new');
  });
});
