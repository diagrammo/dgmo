import { describe, it, expect } from 'vitest';
import { parseInfra } from '../src/infra/parser';
import { computeInfra } from '../src/infra/compute';
import { layoutInfra } from '../src/infra/layout';
import { renderInfra } from '../src/infra/renderer';
import { getPalette } from '../src/palettes';

function renderToSvg(content: string, theme: 'light' | 'dark' = 'light'): string {
  const parsed = parseInfra(content);
  expect(parsed.error).toBeNull();
  const computed = computeInfra(parsed);
  const layout = layoutInfra(computed);
  const paletteConfig = getPalette('nord');
  const palette = theme === 'dark' ? paletteConfig.dark : paletteConfig.light;
  const container = document.createElement('div');
  renderInfra(container, layout, palette, theme === 'dark', parsed.title, parsed.titleLineNumber, parsed.tagGroups, null, false);
  return container.innerHTML;
}

describe('infra renderer', () => {
  it('renders basic nodes and edges', () => {
    const svg = renderToSvg(`chart: infra
edge
  rps: 1000
  -> CDN
CDN
  -> API`);
    expect(svg).toContain('<svg');
    expect(svg).toContain('edge');
    expect(svg).toContain('CDN');
    expect(svg).toContain('API');
  });

  it('renders title', () => {
    const svg = renderToSvg(`chart: infra
title: My Infra
edge
  rps: 100
  -> A`);
    expect(svg).toContain('My Infra');
  });

  it('renders RPS as key-value in nodes', () => {
    const svg = renderToSvg(`chart: infra
edge
  rps: 1000
  -> CDN
CDN
  -> API`);
    expect(svg).toContain('RPS: ');
    expect(svg).toContain('1.0k');
  });

  it('renders metrics (latency, instances) as key-value rows', () => {
    const svg = renderToSvg(`chart: infra
edge
  rps: 500
  -> API
API
  instances: 3
  max-rps: 200
  latency-ms: 45`);
    // Key-value style: "latency: " then "45"
    expect(svg).toContain('latency: ');
    expect(svg).toContain('>45<');
    // Instance count badge
    expect(svg).toContain('3x');
  });

  it('renders overloaded nodes with red stroke', () => {
    const svg = renderToSvg(`chart: infra
edge
  rps: 5000
  -> API
API
  instances: 1
  max-rps: 100`);
    // Overloaded nodes should have the red overload color
    expect(svg).toContain('#ef4444');
  });

  it('renders CB threshold as key-value row', () => {
    const svg = renderToSvg(`chart: infra
edge
  rps: 5000
  -> API
API
  instances: 1
  max-rps: 100
  cb-error-threshold: 50%`);
    // CB threshold shown as key-value row
    expect(svg).toContain('CB err %: ');
    expect(svg).toContain('>50<');
  });

  it('renders Capabilities legend pill; dots only when active', () => {
    const content = `chart: infra
edge
  rps: 1000
  -> CDN
CDN
  cache-hit: 80%
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
    renderInfra(container, layout, palette, false, parsed.title, parsed.titleLineNumber, parsed.tagGroups, 'Capabilities', false);
    const activeSvg = container.innerHTML;
    expect(activeSvg).toContain('<circle');
  });

  it('renders tag legend as collapsed pill', () => {
    const svg = renderToSvg(`chart: infra
tag: Team alias t
  Backend(blue)

edge
  rps: 100
  -> API
API | t: Backend`);
    // Should have collapsed "Team" pill (not expanded entries)
    expect(svg).toContain('Team');
    expect(svg).toContain('data-legend-group="team"');
  });

  it('renders groups with filled background', () => {
    const svg = renderToSvg(`chart: infra
edge
  rps: 1000
  -> [Pool]

[Pool]
  Server
    max-rps: 500`);
    expect(svg).toContain('infra-group');
    expect(svg).toContain('stroke-opacity="0.35"');
    expect(svg).toContain('Pool');
  });

  it('renders edges without arrowheads', () => {
    const svg = renderToSvg(`chart: infra
edge
  rps: 100
  -> A`);
    expect(svg).not.toContain('<marker');
    expect(svg).not.toContain('marker-end');
  });

  it('renders in dark theme', () => {
    const svg = renderToSvg(`chart: infra
edge
  rps: 100
  -> A`, 'dark');
    expect(svg).toContain('<svg');
  });

  it('renders split labels on edges', () => {
    const svg = renderToSvg(`chart: infra
edge
  rps: 1000
  -> LB
LB
  -/api-> API | split: 60%
  -/web-> Web | split: 40%`);
    expect(svg).toContain('/api');
    expect(svg).toContain('/web');
  });

  it('sets data-line-number on nodes and groups', () => {
    const svg = renderToSvg(`chart: infra
edge
  rps: 100
  -> [G]
[G]
  A`);
    expect(svg).toContain('data-line-number');
  });

  it('renders particle animation when animate is true', () => {
    const parsed = parseInfra(`chart: infra
edge
  rps: 1000
  -> CDN
CDN
  -> API`);
    expect(parsed.error).toBeNull();
    const computed = computeInfra(parsed);
    const layout = layoutInfra(computed);
    const palette = getPalette('nord').light;
    const container = document.createElement('div');
    renderInfra(container, layout, palette, false, null, null, undefined, null, true);
    const svg = container.innerHTML;
    expect(svg).toContain('animateMotion');
    expect(svg).toContain('<circle');
    expect(svg).toContain('@keyframes');
  });

  it('omits animation when animate is false', () => {
    const svg = renderToSvg(`chart: infra
edge
  rps: 1000
  -> CDN
CDN
  -> API`);
    expect(svg).not.toContain('animateMotion');
    expect(svg).not.toContain('@keyframes');
  });

  it('respects animate: off option', () => {
    const parsed = parseInfra(`chart: infra
animate: off
edge
  rps: 1000
  -> A`);
    expect(parsed.options.animate).toBe('off');
  });

  it('colors edges red when target is overloaded', () => {
    const parsed = parseInfra(`chart: infra
edge
  rps: 5000
  -> API
API
  instances: 1
  max-rps: 100`);
    expect(parsed.error).toBeNull();
    const computed = computeInfra(parsed);
    const layout = layoutInfra(computed);
    const palette = getPalette('nord').light;
    const container = document.createElement('div');
    renderInfra(container, layout, palette, false, null, null, undefined, null, true);
    const svg = container.innerHTML;
    expect(svg).toContain('#ef4444');
  });

  it('adds overload pulse class to overloaded nodes when animated', () => {
    const parsed = parseInfra(`chart: infra
edge
  rps: 5000
  -> API
API
  instances: 1
  max-rps: 100`);
    expect(parsed.error).toBeNull();
    const computed = computeInfra(parsed);
    const layout = layoutInfra(computed);
    const palette = getPalette('nord').light;
    const container = document.createElement('div');
    renderInfra(container, layout, palette, false, null, null, undefined, null, true);
    const svg = container.innerHTML;
    expect(svg).toContain('infra-node-overload');
    expect(svg).toContain('infra-pulse-overload');
  });

  it('adds warning pulse class to near-capacity nodes when animated', () => {
    const parsed = parseInfra(`chart: infra
edge
  rps: 800
  -> API
API
  instances: 1
  max-rps: 1000`);
    expect(parsed.error).toBeNull();
    const computed = computeInfra(parsed);
    const layout = layoutInfra(computed);
    const palette = getPalette('nord').light;
    const container = document.createElement('div');
    renderInfra(container, layout, palette, false, null, null, undefined, null, true);
    const svg = container.innerHTML;
    expect(svg).toContain('infra-node-warning');
  });

  it('adds CB open animation class when circuit breaker is open', () => {
    const parsed = parseInfra(`chart: infra
edge
  rps: 5000
  -> API
API
  instances: 1
  max-rps: 100
  cb-error-threshold: 50%`);
    expect(parsed.error).toBeNull();
    const computed = computeInfra(parsed);
    const layout = layoutInfra(computed);
    const palette = getPalette('nord').light;
    const container = document.createElement('div');
    renderInfra(container, layout, palette, false, null, null, undefined, null, true);
    const svg = container.innerHTML;
    expect(svg).toContain('infra-node-cb-open');
  });

  it('uses more particles for higher RPS edges', () => {
    const parsed = parseInfra(`chart: infra
edge
  rps: 10000
  -> CDN
CDN
  -> API`);
    expect(parsed.error).toBeNull();
    const computed = computeInfra(parsed);
    const layout = layoutInfra(computed);
    const palette = getPalette('nord').light;
    const container = document.createElement('div');
    renderInfra(container, layout, palette, false, null, null, undefined, null, true);
    const svg = container.innerHTML;
    // Should have multiple animateMotion elements (particles)
    const motionCount = (svg.match(/animateMotion/g) || []).length;
    expect(motionCount).toBeGreaterThan(2);
  });

  it('parses scenario blocks', () => {
    const parsed = parseInfra(`chart: infra
edge
  rps: 1000
  -> API
API
  instances: 3
  max-rps: 500

scenario: peak
  edge
    rps: 10000
  API
    instances: 8`);
    expect(parsed.error).toBeNull();
    expect(parsed.scenarios).toHaveLength(1);
    expect(parsed.scenarios[0].name).toBe('peak');
    expect(parsed.scenarios[0].overrides['edge']).toEqual({ rps: 10000 });
    expect(parsed.scenarios[0].overrides['API']).toEqual({ instances: 8 });
  });

  it('applies scenario overrides to compute', () => {
    const parsed = parseInfra(`chart: infra
edge
  rps: 1000
  -> API
API
  instances: 3
  max-rps: 500

scenario: peak
  edge
    rps: 10000
  API
    instances: 8`);
    expect(parsed.error).toBeNull();

    // Base compute
    const base = computeInfra(parsed);
    const baseApi = base.nodes.find((n) => n.id === 'API')!;
    expect(baseApi.computedRps).toBe(1000);

    // With scenario
    const peak = computeInfra(parsed, { scenario: parsed.scenarios[0] });
    const peakApi = peak.nodes.find((n) => n.id === 'API')!;
    expect(peakApi.computedRps).toBe(10000);
    expect(peakApi.computedInstances).toBe(8);
  });

  it('instance overrides affect overload detection', () => {
    const parsed = parseInfra(`chart: infra
edge
  rps: 5000
  -> API
API
  instances: 10
  max-rps: 500`);
    expect(parsed.error).toBeNull();

    // Base: 10 instances * 500 = 5000 capacity, not overloaded
    const base = computeInfra(parsed);
    expect(base.nodes.find((n) => n.id === 'API')!.overloaded).toBe(false);

    // Override to 1 instance: 1 * 500 = 500 capacity, overloaded at 5000 rps
    const overloaded = computeInfra(parsed, { instanceOverrides: { API: 1 } });
    expect(overloaded.nodes.find((n) => n.id === 'API')!.overloaded).toBe(true);
  });

  it('property overrides change downstream rps', () => {
    const parsed = parseInfra(`chart: infra
edge
  rps: 10000
  -> CDN
CDN
  cache-hit: 80%
  -> API
API
  max-rps: 5000`);
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
    const parsed = parseInfra(`chart: infra
edge
  rps: 10000
  -> Gateway
Gateway
  ratelimit-rps: 5000
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

  it('property overrides take precedence over scenario overrides', () => {
    const parsed = parseInfra(`chart: infra
edge
  rps: 10000
  -> CDN
CDN
  cache-hit: 80%
  -> API
API

scenario: peak
  CDN
    cache-hit: 60`);
    expect(parsed.error).toBeNull();

    // Scenario sets cache-hit to 60% → 4000 rps
    const withScenario = computeInfra(parsed, { scenario: parsed.scenarios[0] });
    expect(withScenario.nodes.find((n) => n.id === 'API')!.computedRps).toBe(4000);

    // Property override to 30% takes precedence over scenario's 60% → 7000 rps
    const withBoth = computeInfra(parsed, {
      scenario: parsed.scenarios[0],
      propertyOverrides: { CDN: { 'cache-hit': 30 } },
    });
    expect(withBoth.nodes.find((n) => n.id === 'API')!.computedRps).toBe(7000);
  });
});
