import { describe, it, expect } from 'vitest';
import { parseInfra } from '../src/infra/parser';
import { computeInfra } from '../src/infra/compute';
import { layoutInfra } from '../src/infra/layout';
import { renderInfra } from '../src/infra/renderer';
import { getPalette } from '../src/palettes';

function renderToSvg(
  content: string,
  theme: 'light' | 'dark' = 'light',
  selectedNodeId?: string
): string {
  const parsed = parseInfra(content);
  expect(parsed.error).toBeNull();
  const computed = computeInfra(parsed);
  const expandedNodeIds = selectedNodeId
    ? new Set([selectedNodeId])
    : undefined;
  const layout = layoutInfra(computed, expandedNodeIds);
  const paletteConfig = getPalette('nord');
  const palette = theme === 'dark' ? paletteConfig.dark : paletteConfig.light;
  const container = document.createElement('div');
  renderInfra(
    container,
    layout,
    palette,
    theme === 'dark',
    parsed.title,
    parsed.titleLineNumber,
    parsed.tagGroups,
    null,
    false,
    null,
    expandedNodeIds ?? null
  );
  return container.innerHTML;
}

describe('infra renderer', () => {
  it('renders basic nodes and edges', () => {
    const svg = renderToSvg(`infra
edge
  rps 1000
  -> CDN
CDN
  -> API`);
    expect(svg).toContain('<svg');
    expect(svg).toContain('edge');
    expect(svg).toContain('CDN');
    expect(svg).toContain('API');
  });

  it('renders title', () => {
    const svg = renderToSvg(`infra My Infra
edge
  rps 100
  -> A`);
    expect(svg).toContain('My Infra');
  });

  it('renders RPS as key-value in nodes', () => {
    const svg = renderToSvg(`infra
edge
  rps 1000
  -> CDN
CDN
  -> API`);
    expect(svg).toContain('RPS: ');
    expect(svg).toContain('1.0k');
  });

  it('renders metrics (latency, instances) as key-value rows', () => {
    // Declared properties only shown when node is selected
    const svg = renderToSvg(
      `infra
edge
  rps 500
  -> API
API
  instances 3
  max-rps 200
  latency-ms 45`,
      'light',
      'API'
    );
    // Key-value style: "latency: " then "45ms"
    expect(svg).toContain('latency: ');
    expect(svg).toContain('>45ms<');
    // Instance count badge
    expect(svg).toContain('3x');
  });

  it('renders overloaded nodes with red stroke', () => {
    const svg = renderToSvg(`infra
edge
  rps 5000
  -> API
API
  instances 1
  max-rps 100`);
    // Overloaded nodes should have the red overload color
    expect(svg).toContain('#ef4444');
  });

  it('renders CB threshold as key-value row', () => {
    // Declared properties only shown when node is selected
    const svg = renderToSvg(
      `infra
edge
  rps 5000
  -> API
API
  instances 1
  max-rps 100
  cb-error-threshold 50%`,
      'light',
      'API'
    );
    // CB threshold shown as key-value row
    expect(svg).toContain('CB error threshold: ');
    expect(svg).toContain('>50%<');
    // max-rps label
    expect(svg).toContain('max RPS: ');
    expect(svg).not.toContain('capacity: ');
  });

  it('renders ratelimit-rps and cb-latency-threshold-ms with correct labels', () => {
    const svg = renderToSvg(
      `infra
edge
  rps 5000
  -> API
API
  ratelimit-rps 1000
  cb-latency-threshold-ms 200`,
      'light',
      'API'
    );
    expect(svg).toContain('rate limit RPS: ');
    expect(svg).toContain('CB latency threshold: ');
    expect(svg).not.toContain('rate limit: ');
    expect(svg).not.toContain('cb latency threshold: ');
  });

  it('renders Capabilities legend pill; dots only when active', () => {
    const content = `infra
edge
  rps 1000
  -> CDN
CDN
  cache-hit 80%
  -> API`;
    // Without active group — pill shows but no dots
    const svg = renderToSvg(content);
    expect(svg).toContain('Capabilities');
    expect(svg).toContain('infra-legend-group');
    expect(svg).not.toContain('<circle');

    // With Capabilities active — dots appear
    const parsed = parseInfra(content);
    expect(parsed.error).toBeNull();
    const computed = computeInfra(parsed);
    const layout = layoutInfra(computed);
    const paletteConfig = getPalette('nord');
    const palette = paletteConfig.light;
    const container = document.createElement('div');
    renderInfra(
      container,
      layout,
      palette,
      false,
      parsed.title,
      parsed.titleLineNumber,
      parsed.tagGroups,
      'Capabilities',
      false
    );
    const activeSvg = container.innerHTML;
    expect(activeSvg).toContain('<circle');
  });

  it('renders tag legend as collapsed pill', () => {
    const svg = renderToSvg(`infra
tag Team t
  Backend(blue)

edge
  rps 100
  -> API
API | t: Backend`);
    // Should have collapsed "Team" pill (not expanded entries)
    expect(svg).toContain('Team');
    expect(svg).toContain('data-legend-group="team"');
  });

  it('renders groups with filled background', () => {
    const svg = renderToSvg(`infra
edge
  rps 1000
  -> [Pool]

[Pool]
  Server
    max-rps 500`);
    expect(svg).toContain('infra-group');
    expect(svg).toContain('stroke-opacity="0.35"');
    expect(svg).toContain('Pool');
  });

  it('renders edges without arrowheads', () => {
    const svg = renderToSvg(`infra
edge
  rps 100
  -> A`);
    expect(svg).not.toContain('<marker');
    expect(svg).not.toContain('marker-end');
  });

  it('renders in dark theme', () => {
    const svg = renderToSvg(
      `infra
edge
  rps 100
  -> A`,
      'dark'
    );
    expect(svg).toContain('<svg');
  });

  it('renders split labels on edges', () => {
    const svg = renderToSvg(`infra
edge
  rps 1000
  -> LB
LB
  -/api-> API | split: 60%
  -/web-> Web | split: 40%`);
    expect(svg).toContain('/api');
    expect(svg).toContain('/web');
  });

  it('sets data-line-number on nodes and groups', () => {
    const svg = renderToSvg(`infra
edge
  rps 100
  -> [G]
[G]
  A`);
    expect(svg).toContain('data-line-number');
  });

  it('renders particle animation when animate is true', () => {
    const parsed = parseInfra(`infra
edge
  rps 1000
  -> CDN
CDN
  -> API`);
    expect(parsed.error).toBeNull();
    const computed = computeInfra(parsed);
    const layout = layoutInfra(computed);
    const palette = getPalette('nord').light;
    const container = document.createElement('div');
    renderInfra(
      container,
      layout,
      palette,
      false,
      null,
      null,
      undefined,
      null,
      true
    );
    const svg = container.innerHTML;
    expect(svg).toContain('animateMotion');
    expect(svg).toContain('<circle');
    expect(svg).toContain('@keyframes');
  });

  it('omits animation when animate is false', () => {
    const svg = renderToSvg(`infra
edge
  rps 1000
  -> CDN
CDN
  -> API`);
    expect(svg).not.toContain('animateMotion');
    expect(svg).not.toContain('@keyframes');
  });

  it('respects no-animate option', () => {
    const parsed = parseInfra(`infra
no-animate
edge
  rps 1000
  -> A`);
    expect(parsed.options.animate).toBe('off');
  });

  it('colors edges red when target is overloaded', () => {
    const parsed = parseInfra(`infra
edge
  rps 5000
  -> API
API
  instances 1
  max-rps 100`);
    expect(parsed.error).toBeNull();
    const computed = computeInfra(parsed);
    const layout = layoutInfra(computed);
    const palette = getPalette('nord').light;
    const container = document.createElement('div');
    renderInfra(
      container,
      layout,
      palette,
      false,
      null,
      null,
      undefined,
      null,
      true
    );
    const svg = container.innerHTML;
    expect(svg).toContain('#ef4444');
  });

  it('adds overload pulse class to overloaded nodes when animated', () => {
    const parsed = parseInfra(`infra
edge
  rps 5000
  -> API
API
  instances 1
  max-rps 100`);
    expect(parsed.error).toBeNull();
    const computed = computeInfra(parsed);
    const layout = layoutInfra(computed);
    const palette = getPalette('nord').light;
    const container = document.createElement('div');
    renderInfra(
      container,
      layout,
      palette,
      false,
      null,
      null,
      undefined,
      null,
      true
    );
    const svg = container.innerHTML;
    expect(svg).toContain('infra-node-overload');
    expect(svg).toContain('infra-pulse-overload');
  });

  it('adds warning pulse class to near-capacity nodes when animated', () => {
    const parsed = parseInfra(`infra
edge
  rps 800
  -> API
API
  instances 1
  max-rps 1000`);
    expect(parsed.error).toBeNull();
    const computed = computeInfra(parsed);
    const layout = layoutInfra(computed);
    const palette = getPalette('nord').light;
    const container = document.createElement('div');
    renderInfra(
      container,
      layout,
      palette,
      false,
      null,
      null,
      undefined,
      null,
      true
    );
    const svg = container.innerHTML;
    expect(svg).toContain('infra-node-warning');
  });

  it('adds CB open animation class when circuit breaker is open', () => {
    const parsed = parseInfra(`infra
edge
  rps 5000
  -> API
API
  instances 1
  max-rps 100
  cb-error-threshold 50%`);
    expect(parsed.error).toBeNull();
    const computed = computeInfra(parsed);
    const layout = layoutInfra(computed);
    const palette = getPalette('nord').light;
    const container = document.createElement('div');
    renderInfra(
      container,
      layout,
      palette,
      false,
      null,
      null,
      undefined,
      null,
      true
    );
    const svg = container.innerHTML;
    expect(svg).toContain('infra-node-cb-open');
  });

  it('renders CB state row as inverted pill when CB is open', () => {
    const parsed = parseInfra(`infra
edge
  rps 5000
  -> API
API
  instances 1
  max-rps 100
  cb-error-threshold 50%`);
    expect(parsed.error).toBeNull();
    const computed = computeInfra(parsed);
    const layout = layoutInfra(computed);
    const palette = getPalette('nord').light;
    const container = document.createElement('div');
    renderInfra(
      container,
      layout,
      palette,
      false,
      null,
      null,
      undefined,
      null,
      false
    );
    const svg = container.innerHTML;
    // Should show CB key and OPEN value as inverted pill with palette text on red background
    expect(svg).toContain('CB: ');
    expect(svg).toContain('OPEN');
    expect(svg).toContain(palette.text);
    expect(svg).toContain('#ef4444');
  });

  it('renders low availability as inverted pill', () => {
    const parsed = parseInfra(`infra
edge
  rps 5000
  -> API
API
  instances 1
  max-rps 100`);
    expect(parsed.error).toBeNull();
    const computed = computeInfra(parsed);
    const layout = layoutInfra(computed);
    const palette = getPalette('nord').light;
    const container = document.createElement('div');
    renderInfra(
      container,
      layout,
      palette,
      false,
      null,
      null,
      undefined,
      null,
      false
    );
    const svg = container.innerHTML;
    // Availability < 95% should render as inverted pill with palette text color
    expect(svg).toContain('availability:');
    expect(svg).toContain(palette.text);
  });

  it('uses more particles for higher RPS edges', () => {
    const parsed = parseInfra(`infra
edge
  rps 10000
  -> CDN
CDN
  -> API`);
    expect(parsed.error).toBeNull();
    const computed = computeInfra(parsed);
    const layout = layoutInfra(computed);
    const palette = getPalette('nord').light;
    const container = document.createElement('div');
    renderInfra(
      container,
      layout,
      palette,
      false,
      null,
      null,
      undefined,
      null,
      true
    );
    const svg = container.innerHTML;
    // Should have multiple animateMotion elements (particles)
    const motionCount = (svg.match(/animateMotion/g) || []).length;
    expect(motionCount).toBeGreaterThan(2);
  });

  it('instance overrides affect overload detection', () => {
    const parsed = parseInfra(`infra
edge
  rps 5000
  -> API
API
  instances 10
  max-rps 500`);
    expect(parsed.error).toBeNull();

    // Base: 10 instances * 500 = 5000 capacity, not overloaded
    const base = computeInfra(parsed);
    expect(base.nodes.find((n) => n.id === 'API')!.overloaded).toBe(false);

    // Override to 1 instance: 1 * 500 = 500 capacity, overloaded at 5000 rps
    const overloaded = computeInfra(parsed, { instanceOverrides: { API: 1 } });
    expect(overloaded.nodes.find((n) => n.id === 'API')!.overloaded).toBe(true);
  });

  it('property overrides change downstream rps', () => {
    const parsed = parseInfra(`infra
edge
  rps 10000
  -> CDN
CDN
  cache-hit 80%
  -> API
API
  max-rps 5000`);
    expect(parsed.error).toBeNull();

    // Base: CDN cache-hit 80% → 2000 rps reach API
    const base = computeInfra(parsed);
    expect(base.nodes.find((n) => n.id === 'API')!.computedRps).toBe(2000);
    expect(base.nodes.find((n) => n.id === 'API')!.overloaded).toBe(false);

    // Override CDN cache-hit to 50% → 5000 rps reach API
    const adjusted = computeInfra(parsed, {
      propertyOverrides: { CDN: { 'cache-hit': 50 } },
    });
    expect(adjusted.nodes.find((n) => n.id === 'API')!.computedRps).toBe(5000);
    expect(adjusted.nodes.find((n) => n.id === 'API')!.overloaded).toBe(false);

    // Override CDN cache-hit to 0% → 10000 rps reach API → overloaded
    const noCache = computeInfra(parsed, {
      propertyOverrides: { CDN: { 'cache-hit': 0 } },
    });
    expect(noCache.nodes.find((n) => n.id === 'API')!.computedRps).toBe(10000);
    expect(noCache.nodes.find((n) => n.id === 'API')!.overloaded).toBe(true);
  });

  it('property overrides for ratelimit-rps cap downstream traffic', () => {
    const parsed = parseInfra(`infra
edge
  rps 10000
  -> Gateway
Gateway
  ratelimit-rps 5000
  -> API
API`);
    expect(parsed.error).toBeNull();

    // Base: ratelimit caps at 5000
    const base = computeInfra(parsed);
    expect(base.nodes.find((n) => n.id === 'API')!.computedRps).toBe(5000);

    // Override ratelimit to 2000
    const limited = computeInfra(parsed, {
      propertyOverrides: { Gateway: { 'ratelimit-rps': 2000 } },
    });
    expect(limited.nodes.find((n) => n.id === 'API')!.computedRps).toBe(2000);
  });

  it('renders serverless node with instances row and property rows', () => {
    // Select Lambda to show declared properties (duration, cold start)
    const svg = renderToSvg(
      `infra
edge
  rps 3000
  -> Lambda
Lambda
  concurrency 1000
  duration-ms 200
  cold-start-ms 250`,
      'light',
      'Lambda'
    );
    expect(svg).toContain('Lambda');
    // Computed instances row: 600 / 1,000 (3000 rps × 200ms / 1000 = 600 demand vs 1000 concurrency)
    expect(svg).toContain('instances');
    expect(svg).toContain('600');
    // No header badge for serverless — instances are in the computed row
    expect(svg).not.toContain('~600');
    // Declared property display names (visible because node is selected)
    expect(svg).toContain('duration');
    expect(svg).toContain('cold start');
    // MS-formatted values
    expect(svg).toContain('200ms');
    expect(svg).toContain('250ms');
  });

  it('renders queue node with buffer, drain, lag, and overflow rows', () => {
    // Select Queue to show declared properties (buffer, drain, retention, partitions)
    const svg = renderToSvg(
      `infra
edge
  rps 2000
  -> Queue
Queue
  buffer 100000
  drain-rate 500
  retention-hours 72
  partitions 6
  -> Processor
Processor
  max-rps 1000`,
      'light',
      'Queue'
    );
    expect(svg).toContain('Queue');
    // Buffer formatted as 100k
    expect(svg).toContain('100k');
    // Drain rate
    expect(svg).toContain('drain');
    // Lag row (buffer is filling: 2000 - 500 = 1500)
    expect(svg).toContain('lag');
    // Overflow row
    expect(svg).toContain('overflow');
  });

  it('renders serverless node with RPS showing capacity denominator', () => {
    const svg = renderToSvg(`infra
edge
  rps 3000
  -> Lambda
Lambda
  concurrency 1000
  duration-ms 200`);
    // Should show "3.0k / 5.0k" (RPS / effective capacity)
    expect(svg).toContain('3.0k');
    expect(svg).toContain('5.0k');
  });

  it('property overrides affect compute (cache-hit passthrough)', () => {
    const parsed = parseInfra(`infra
edge
  rps 10000
  -> CDN
CDN
  cache-hit 80%
  -> API
API`);
    expect(parsed.error).toBeNull();

    // Base: 80% cache-hit → 20% passes → 2000 rps to API
    const base = computeInfra(parsed);
    expect(base.nodes.find((n) => n.id === 'API')!.computedRps).toBe(2000);

    // Property override to 30% cache-hit → 70% passes → 7000 rps to API
    const withOverride = computeInfra(parsed, {
      propertyOverrides: { CDN: { 'cache-hit': 30 } },
    });
    expect(withOverride.nodes.find((n) => n.id === 'API')!.computedRps).toBe(
      7000
    );
  });

  it('renders async edge with stroke-dasharray', () => {
    const svg = renderToSvg(`infra
edge
  rps 100
  -> API
API
  ~> EventBus`);
    // The async edge (API -> EventBus) should have stroke-dasharray
    expect(svg).toContain('stroke-dasharray="6 4"');
  });

  it('does not render stroke-dasharray on sync edges', () => {
    const svg = renderToSvg(`infra
edge
  rps 100
  -> API
API
  -> Database`);
    // Sync edges should not have stroke-dasharray="6 4" on edge paths
    // (note: other elements may use dasharray for animations, so check specifically edge paths)
    // None of the simple edge paths should have dasharray
    // Just verify no 6 4 pattern on the main edge path strokes
    expect(svg).not.toMatch(/stroke-dasharray="6 4"/);
  });
});
