// ============================================================
// .dgmo → Mermaid Translation Layer
// Parses dgmo quadrant syntax and generates valid Mermaid code.
// ============================================================

import { resolveColor } from './colors';

// ============================================================
// Types
// ============================================================

interface QuadrantLabel {
  text: string;
  color: string | null;
  lineNumber: number;
}

export interface ParsedQuadrant {
  title: string | null;
  titleLineNumber: number | null;
  xAxis: [string, string] | null;
  xAxisLineNumber: number | null;
  yAxis: [string, string] | null;
  yAxisLineNumber: number | null;
  quadrants: {
    topRight: QuadrantLabel | null;
    topLeft: QuadrantLabel | null;
    bottomLeft: QuadrantLabel | null;
    bottomRight: QuadrantLabel | null;
  };
  points: { label: string; x: number; y: number; lineNumber: number }[];
  error: string | null;
}

// ============================================================
// Parser
// ============================================================

/** Regex for quadrant label lines: `top-right: Promote (green)` */
const QUADRANT_LABEL_RE = /^(.+?)(?:\s*\(([^)]+)\))?\s*$/;

/** Regex for data point lines: `Label: 0.9, 0.5` */
const DATA_POINT_RE = /^(.+?):\s*([0-9]*\.?[0-9]+)\s*,\s*([0-9]*\.?[0-9]+)\s*$/;

const QUADRANT_POSITIONS = new Set([
  'top-right',
  'top-left',
  'bottom-left',
  'bottom-right',
]);

/**
 * Parses a .dgmo quadrant document into a structured object.
 * Lines are processed sequentially; unknown lines are silently skipped.
 */
export function parseQuadrant(content: string): ParsedQuadrant {
  const result: ParsedQuadrant = {
    title: null,
    titleLineNumber: null,
    xAxis: null,
    xAxisLineNumber: null,
    yAxis: null,
    yAxisLineNumber: null,
    quadrants: {
      topRight: null,
      topLeft: null,
      bottomLeft: null,
      bottomRight: null,
    },
    points: [],
    error: null,
  };

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNumber = i + 1; // 1-indexed for editor

    // Skip empty lines and comments
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    // Skip the chart: directive (already consumed by router)
    if (/^chart\s*:/i.test(line)) continue;

    // title: <text>
    const titleMatch = line.match(/^title\s*:\s*(.+)/i);
    if (titleMatch) {
      result.title = titleMatch[1].trim();
      result.titleLineNumber = lineNumber;
      continue;
    }

    // x-axis: Low, High
    const xMatch = line.match(/^x-axis\s*:\s*(.+)/i);
    if (xMatch) {
      const parts = xMatch[1].split(',').map((s) => s.trim());
      if (parts.length >= 2) {
        result.xAxis = [parts[0], parts[1]];
        result.xAxisLineNumber = lineNumber;
      }
      continue;
    }

    // y-axis: Low, High
    const yMatch = line.match(/^y-axis\s*:\s*(.+)/i);
    if (yMatch) {
      const parts = yMatch[1].split(',').map((s) => s.trim());
      if (parts.length >= 2) {
        result.yAxis = [parts[0], parts[1]];
        result.yAxisLineNumber = lineNumber;
      }
      continue;
    }

    // Quadrant position labels: top-right: Label (color)
    const posMatch = line.match(
      /^(top-right|top-left|bottom-left|bottom-right)\s*:\s*(.+)/i
    );
    if (posMatch) {
      const position = posMatch[1].toLowerCase();
      const labelMatch = posMatch[2].match(QUADRANT_LABEL_RE);
      if (labelMatch) {
        const label: QuadrantLabel = {
          text: labelMatch[1].trim(),
          color: labelMatch[2] ? resolveColor(labelMatch[2].trim()) : null,
          lineNumber,
        };
        if (position === 'top-right') result.quadrants.topRight = label;
        else if (position === 'top-left') result.quadrants.topLeft = label;
        else if (position === 'bottom-left')
          result.quadrants.bottomLeft = label;
        else if (position === 'bottom-right')
          result.quadrants.bottomRight = label;
      }
      continue;
    }

    // Data points: Label: x, y
    const pointMatch = line.match(DATA_POINT_RE);
    if (pointMatch) {
      // Make sure this isn't a quadrant position keyword
      const key = pointMatch[1].trim().toLowerCase();
      if (!QUADRANT_POSITIONS.has(key)) {
        result.points.push({
          label: pointMatch[1].trim(),
          x: parseFloat(pointMatch[2]),
          y: parseFloat(pointMatch[3]),
          lineNumber,
        });
      }
      continue;
    }
  }

  if (result.points.length === 0) {
    result.error = 'No data points found. Add lines like: Label: 0.5, 0.7';
  }

  return result;
}

// ============================================================
// Mermaid Builder
// ============================================================

/**
 * Generates valid Mermaid quadrantChart syntax from a parsed quadrant.
 * Returns a string ready for the Mermaid renderer.
 */
export function buildMermaidQuadrant(
  parsed: ParsedQuadrant,
  options: {
    isDark?: boolean;
    textColor?: string;
    mutedTextColor?: string;
  } = {}
): string {
  const { isDark = false, textColor, mutedTextColor } = options;
  const lines: string[] = [];

  // %%{init}%% block — fill colors with reduced opacity + text color overrides
  const fillAlpha = isDark ? '30' : '55';
  const primaryText = textColor ?? (isDark ? '#d0d0d0' : '#333333');
  const quadrantLabelText = mutedTextColor ?? (isDark ? '#888888' : '#666666');

  const colorMap: Record<string, string> = {};
  if (parsed.quadrants.topRight?.color)
    colorMap.quadrant1Fill = parsed.quadrants.topRight.color + fillAlpha;
  if (parsed.quadrants.topLeft?.color)
    colorMap.quadrant2Fill = parsed.quadrants.topLeft.color + fillAlpha;
  if (parsed.quadrants.bottomLeft?.color)
    colorMap.quadrant3Fill = parsed.quadrants.bottomLeft.color + fillAlpha;
  if (parsed.quadrants.bottomRight?.color)
    colorMap.quadrant4Fill = parsed.quadrants.bottomRight.color + fillAlpha;

  // Quadrant labels use muted color, points use primary text color
  colorMap.quadrant1TextFill = quadrantLabelText;
  colorMap.quadrant2TextFill = quadrantLabelText;
  colorMap.quadrant3TextFill = quadrantLabelText;
  colorMap.quadrant4TextFill = quadrantLabelText;
  colorMap.quadrantPointTextFill = primaryText;
  colorMap.quadrantXAxisTextFill = primaryText;
  colorMap.quadrantYAxisTextFill = primaryText;
  colorMap.quadrantTitleFill = primaryText;

  const vars = JSON.stringify(colorMap);
  lines.push(`%%{init: {"themeVariables": ${vars}}}%%`);

  lines.push('quadrantChart');

  if (parsed.title) {
    lines.push(`    title ${parsed.title}`);
  }

  if (parsed.xAxis) {
    lines.push(`    x-axis ${parsed.xAxis[0]} --> ${parsed.xAxis[1]}`);
  }

  if (parsed.yAxis) {
    lines.push(`    y-axis ${parsed.yAxis[0]} --> ${parsed.yAxis[1]}`);
  }

  // Helper to quote labels that need it (contain spaces or special chars)
  const quote = (s: string): string => (/[\s,:[\]]/.test(s) ? `"${s}"` : s);

  // Quadrant labels: 1=top-right, 2=top-left, 3=bottom-left, 4=bottom-right
  if (parsed.quadrants.topRight) {
    lines.push(`    quadrant-1 ${quote(parsed.quadrants.topRight.text)}`);
  }
  if (parsed.quadrants.topLeft) {
    lines.push(`    quadrant-2 ${quote(parsed.quadrants.topLeft.text)}`);
  }
  if (parsed.quadrants.bottomLeft) {
    lines.push(`    quadrant-3 ${quote(parsed.quadrants.bottomLeft.text)}`);
  }
  if (parsed.quadrants.bottomRight) {
    lines.push(`    quadrant-4 ${quote(parsed.quadrants.bottomRight.text)}`);
  }

  // Data points
  for (const point of parsed.points) {
    lines.push(`    ${quote(point.label)}: [${point.x}, ${point.y}]`);
  }

  return lines.join('\n');
}
