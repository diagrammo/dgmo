import { describe, it, expect } from 'vitest';
import { render } from '../src/render';

/**
 * Covers `exportPert` in `src/d3.ts` — the render path taken by the
 * CLI, the MCP server, share-link images and every doc-site embed.
 *
 * The renderer's own subtitle/caption tests exercise
 * `renderPertForExport`, which has no production caller: for months
 * they were green while every shipped PERT render omitted the project
 * duration entirely (#420). These assertions go through `render()`, so
 * they fail if the wiring is dropped again.
 */

const BASIC = `pert Pirate Voyage
time-unit w
default-confidence medium

A 1 2 3
  -> B
  -> C

B 2 3 4
  -> D

C 1 2 3
  -> D

D 1 2 3`;

async function svgFor(content: string): Promise<string> {
  const { svg } = await render(content, { theme: 'light' });
  return svg;
}

describe('pert export path — the project duration always reaches the page', () => {
  it('draws the μ ± σ subtitle under the title', async () => {
    const svg = await svgFor(BASIC);
    expect(svg).toContain('class="pert-subtitle"');
    expect(svg).toMatch(
      /pert-subtitle[^>]*>≈ [\d.]+ weeks \(± [\d.]+ weeks?\)/
    );
  });

  it('gives σ its unit, so the parenthetical is not a bare number', async () => {
    const svg = await svgFor(BASIC);
    const subtitle = svg.match(/class="pert-subtitle"[^>]*>([^<]*)/)?.[1] ?? '';
    expect(subtitle).not.toMatch(/\(± [\d.]+\)/);
    expect(subtitle).toMatch(/\(± [\d.]+ (week|weeks|day|days)\)/);
  });

  it('draws the project-stats caption alongside the diagram', async () => {
    const svg = await svgFor(BASIC);
    expect(svg).toContain('data-pert-caption');
    expect(svg).toContain('Expected duration:');
  });

  it('keeps both when `no-analysis` suppresses the tornado and S-curve', async () => {
    const svg = await svgFor(
      BASIC.replace('time-unit w', 'time-unit w\nno-analysis')
    );
    expect(svg).toContain('class="pert-subtitle"');
    expect(svg).toContain('Expected duration:');
    expect(svg).not.toContain('pert-tornado-block');
    expect(svg).not.toContain('pert-scurve-block');
  });

  it('keeps the subtitle when `no-title` suppresses the title', async () => {
    const svg = await svgFor(
      BASIC.replace('time-unit w', 'time-unit w\nno-title')
    );
    expect(svg).not.toContain('class="pert-title chart-title"');
    expect(svg).toContain('class="pert-subtitle"');
  });

  it('drops the ± in analytical mode, matching what the caption reports', async () => {
    const svg = await svgFor(
      BASIC.replace('time-unit w', 'time-unit w\ntrials 50')
    );
    const subtitle = svg.match(/class="pert-subtitle"[^>]*>([^<]*)/)?.[1] ?? '';
    expect(subtitle).toMatch(/^≈ [\d.]+ weeks$/);
    expect(svg).toContain('Expected duration:');
    expect(svg).not.toMatch(/Expected duration:[^<]*±/);
  });

  it('anchors the subtitle to a calendar date when `start-date` is given', async () => {
    const svg = await svgFor(
      BASIC.replace('time-unit w', 'time-unit w\nstart-date 2026-06-01')
    );
    const subtitle = svg.match(/class="pert-subtitle"[^>]*>([^<]*)/)?.[1] ?? '';
    expect(subtitle).toMatch(/^Expected finish: \d{4}-\d{2}-\d{2} · ≈ /);
    expect(subtitle).toContain('of work');
  });
});
