import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseChart } from '../src/chart';
import { parseExtendedChart } from '../src/echarts';
import { parseVisualization } from '../src/d3';
import { parseCycle } from '../src/cycle/parser';
import { parseMindmap } from '../src/mindmap/parser';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

const EXAMPLES_DIR = resolve(__dirname, '../../dgmo-content/examples');
const GALLERY_DIR = resolve(__dirname, '../gallery/fixtures');

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(full, out);
    else if (entry.endsWith('.dgmo')) out.push(full);
  }
  return out;
}

function firstNonCommentLine(content: string): string {
  for (const raw of content.split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('//')) continue;
    return l.toLowerCase();
  }
  return '';
}

function pickParser(
  content: string
): 'simple' | 'extended' | 'd3' | 'cycle' | 'mindmap' | 'unknown' {
  const first = firstNonCommentLine(content);
  if (first.startsWith('cycle')) return 'cycle';
  if (first.startsWith('mindmap')) return 'mindmap';
  for (const t of [
    'bar',
    'line',
    'multi-line',
    'pie',
    'doughnut',
    'area',
    'polar-area',
    'radar',
    'bar-stacked',
  ]) {
    if (first.startsWith(t)) return 'simple';
  }
  for (const t of [
    'scatter',
    'bubble',
    'sankey',
    'chord',
    'function',
    'heatmap',
    'funnel',
  ]) {
    if (first.startsWith(t)) return 'extended';
  }
  for (const t of [
    'slope',
    'arc',
    'wordcloud',
    'venn',
    'quadrant',
    'timeline',
  ]) {
    if (first.startsWith(t)) return 'd3';
  }
  return 'unknown';
}

const exampleFiles = walk(EXAMPLES_DIR);
const galleryFiles = walk(GALLERY_DIR);
const allFiles = [...exampleFiles, ...galleryFiles];

describe('examples + gallery render without parser errors (Task E5 / AC26)', () => {
  // Sanity: we found files.
  it('has files to test', () => {
    expect(allFiles.length).toBeGreaterThan(0);
  });

  for (const file of allFiles) {
    const rel = file.replace(/^.*\/(dgmo-content|gallery)/, '$1');
    it(`parses ${rel} without error`, () => {
      const content = readFileSync(file, 'utf-8');
      const kind = pickParser(content);
      let error: string | null = null;
      switch (kind) {
        case 'simple':
          error = parseChart(content, palette).error;
          break;
        case 'extended':
          error = parseExtendedChart(content, palette).error;
          break;
        case 'd3':
          error = parseVisualization(content, palette).error;
          break;
        case 'cycle':
          error = parseCycle(content, palette).error;
          break;
        case 'mindmap':
          error = parseMindmap(content, palette).error;
          break;
        case 'unknown':
          // Non-data charts (sequence, infra, c4, gantt, etc.) — skip.
          // These have their own parsers and aren't in scope for this guard.
          return;
      }
      expect(error, `${rel}: ${error}`).toBeNull();
    });
  }
});
