import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import {
  measureIndent,
  parseFirstLine,
  parsePipeMetadata,
  OPTION_NOCOLON_RE,
} from '../utils/parsing';
import type {
  ParsedTechRadar,
  TechRadarQuadrant,
  TechRadarBlip,
  QuadrantPosition,
  BlipTrend,
} from './types';

const VALID_POSITIONS: readonly QuadrantPosition[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

const VALID_TRENDS: readonly BlipTrend[] = ['new', 'up', 'down', 'stable'];

/** Clockwise order for global numbering: TL, TR, BR, BL. */
const POSITION_ORDER: readonly QuadrantPosition[] = [
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-left',
];

/** Known tech-radar options (key-value). */
const KNOWN_OPTIONS = new Set<string>([]);
/** Known tech-radar boolean options (bare keyword). */
const KNOWN_BOOLEANS = new Set<string>([]);

export function parseTechRadar(content: string): ParsedTechRadar {
  const result: ParsedTechRadar = {
    type: 'tech-radar',
    title: '',
    titleLineNumber: 0,
    rings: [],
    quadrants: [],
    options: {},
    diagnostics: [],
    error: null,
  };

  const fail = (line: number, message: string): ParsedTechRadar => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  const warn = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  if (!content || !content.trim()) {
    return fail(0, 'No content provided');
  }

  const lines = content.split('\n');
  let headerParsed = false;
  let inRingsBlock = false;
  let currentQuadrant: TechRadarQuadrant | null = null;
  let currentBlip: TechRadarBlip | null = null;
  let blipBaseIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    const trimmed = line.trim();
    const indent = measureIndent(line);

    // Skip empty lines
    if (!trimmed) {
      if (inRingsBlock && result.rings.length > 0) {
        inRingsBlock = false;
      }
      continue;
    }

    // Skip comments
    if (trimmed.startsWith('//')) continue;

    // --- First line: chart type + title ---
    if (!headerParsed) {
      const firstLine = parseFirstLine(trimmed);
      if (firstLine && firstLine.chartType === 'tech-radar') {
        result.title = firstLine.title ?? '';
        result.titleLineNumber = lineNumber;
        headerParsed = true;
        continue;
      }
      // If first non-empty line is not the chart type, fail
      return fail(lineNumber, 'Expected "tech-radar" chart type declaration');
    }

    // --- Rings block ---
    if (indent === 0 && trimmed.toLowerCase() === 'rings') {
      if (result.rings.length > 0) {
        warn(lineNumber, 'Duplicate "rings" block — using last one');
        result.rings = [];
      }
      inRingsBlock = true;
      currentBlip = null;
      currentQuadrant = null;
      continue;
    }

    if (inRingsBlock) {
      if (indent > 0) {
        result.rings.push({ name: trimmed, lineNumber });
        continue;
      }
      // Non-indented line ends rings block
      inRingsBlock = false;
    }

    // --- Options (bare keyword or key value, top-level only) ---
    if (indent === 0 && !trimmed.includes('|')) {
      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (optMatch) {
        const key = optMatch[1].toLowerCase();
        if (KNOWN_OPTIONS.has(key)) {
          result.options[key] = optMatch[2].trim();
          currentBlip = null;
          continue;
        }
      }
      if (KNOWN_BOOLEANS.has(trimmed.toLowerCase())) {
        result.options[trimmed.toLowerCase()] = 'on';
        currentBlip = null;
        continue;
      }
    }

    // --- Quadrant section header: `Name | quadrant: position` ---
    if (indent === 0 && trimmed.includes('|')) {
      const segments = trimmed.split('|');
      const meta = parsePipeMetadata(segments);
      const quadrantPos = meta['quadrant'];

      if (quadrantPos) {
        const position = quadrantPos.toLowerCase() as QuadrantPosition;
        if (!VALID_POSITIONS.includes(position)) {
          const hint = suggest(position, [...VALID_POSITIONS]);
          let msg = `Invalid quadrant position "${quadrantPos}". Must be one of: ${VALID_POSITIONS.join(', ')}`;
          if (hint) msg += `. ${hint}`;
          result.diagnostics.push(makeDgmoError(lineNumber, msg));
          continue;
        }

        // Check for duplicate position
        const existing = result.quadrants.find((q) => q.position === position);
        if (existing) {
          result.diagnostics.push(
            makeDgmoError(
              lineNumber,
              `Duplicate quadrant position "${position}" — already used by "${existing.name}"`
            )
          );
          continue;
        }

        const name = segments[0].trim();
        const color = meta['color'] ?? null;

        currentQuadrant = {
          name,
          position,
          color,
          lineNumber,
          blips: [],
        };
        result.quadrants.push(currentQuadrant);
        currentBlip = null;
        continue;
      }
    }

    // --- Blip: indented line with pipe metadata under a quadrant ---
    if (currentQuadrant && indent > 0 && trimmed.includes('|')) {
      const segments = trimmed.split('|');
      const meta = parsePipeMetadata(segments);
      const ringName = meta['ring'];

      if (!ringName) {
        result.diagnostics.push(
          makeDgmoError(
            lineNumber,
            `Blip "${segments[0].trim()}" is missing required "ring" metadata`
          )
        );
        continue;
      }

      // Validate ring name matches a declared ring
      if (
        result.rings.length > 0 &&
        !result.rings.some(
          (r) => r.name.toLowerCase() === ringName.toLowerCase()
        )
      ) {
        const hint = suggest(
          ringName,
          result.rings.map((r) => r.name)
        );
        let msg = `Unknown ring "${ringName}" on blip "${segments[0].trim()}"`;
        if (hint) msg += `. ${hint}`;
        result.diagnostics.push(makeDgmoError(lineNumber, msg));
        continue;
      }

      // Resolve the canonical ring name (case-insensitive match)
      const canonicalRing =
        result.rings.find(
          (r) => r.name.toLowerCase() === ringName.toLowerCase()
        )?.name ?? ringName;

      // Parse optional trend
      let trend: BlipTrend | null = null;
      if (meta['trend']) {
        const trendVal = meta['trend'].toLowerCase() as BlipTrend;
        if (!VALID_TRENDS.includes(trendVal)) {
          const hint = suggest(meta['trend'], [...VALID_TRENDS]);
          let msg = `Unknown trend "${meta['trend']}" on blip "${segments[0].trim()}". Must be one of: ${VALID_TRENDS.join(', ')}`;
          if (hint) msg += `. ${hint}`;
          result.diagnostics.push(makeDgmoError(lineNumber, msg, 'warning'));
        } else {
          trend = trendVal;
        }
      }

      currentBlip = {
        name: segments[0].trim(),
        ring: canonicalRing,
        trend,
        description: [],
        lineNumber,
        globalNumber: 0, // assigned later
      };
      blipBaseIndent = indent;
      currentQuadrant.blips.push(currentBlip);
      continue;
    }

    // --- Description lines: indented deeper than blip ---
    if (currentBlip && indent > blipBaseIndent) {
      currentBlip.description.push(trimmed);
      continue;
    }

    // --- Blip without pipe metadata (plain indented line under quadrant) ---
    if (currentQuadrant && indent > 0 && !trimmed.includes('|')) {
      // Could be a description line for the current blip
      if (currentBlip && indent > blipBaseIndent) {
        currentBlip.description.push(trimmed);
        continue;
      }
      // Otherwise it's a blip missing ring metadata
      result.diagnostics.push(
        makeDgmoError(
          lineNumber,
          `Blip "${trimmed}" is missing required pipe metadata (ring assignment). Use: ${trimmed} | ring: RingName`
        )
      );
      continue;
    }

    // --- Unrecognized top-level line ---
    if (indent === 0) {
      // Could be a quadrant without pipe metadata
      if (!trimmed.includes('|') && headerParsed && result.rings.length > 0) {
        warn(
          lineNumber,
          `Unrecognized line "${trimmed}". Quadrant headers require pipe metadata: ${trimmed} | quadrant: top-left`
        );
      }
    }
  }

  // --- Validation ---

  if (result.rings.length === 0) {
    result.diagnostics.push(
      makeDgmoError(
        0,
        'Missing "rings" block — declare ring names before quadrant sections'
      )
    );
  }

  if (result.quadrants.length !== 4) {
    const msg =
      result.quadrants.length === 0
        ? 'No quadrants declared. Exactly 4 quadrants are required.'
        : `Expected exactly 4 quadrants, found ${result.quadrants.length}. Each quadrant needs a unique position (top-left, top-right, bottom-left, bottom-right).`;
    result.diagnostics.push(makeDgmoError(0, msg));
  }

  // --- Global numbering ---
  assignGlobalNumbers(result);

  return result;
}

/**
 * Assign global blip numbers. Order:
 * 1. Quadrants in clockwise order: top-left, top-right, bottom-right, bottom-left
 * 2. Within each quadrant: rings from innermost to outermost
 * 3. Within each ring: declaration order
 */
function assignGlobalNumbers(result: ParsedTechRadar): void {
  const ringOrder = result.rings.map((r) => r.name);
  let counter = 1;

  for (const position of POSITION_ORDER) {
    const quadrant = result.quadrants.find((q) => q.position === position);
    if (!quadrant) continue;

    // Sort blips by ring order (innermost first), then by declaration order
    const sortedBlips = [...quadrant.blips].sort((a, b) => {
      const aRing = ringOrder.indexOf(a.ring);
      const bRing = ringOrder.indexOf(b.ring);
      if (aRing !== bRing) return aRing - bRing;
      return a.lineNumber - b.lineNumber;
    });

    for (const blip of sortedBlips) {
      blip.globalNumber = counter++;
    }
  }
}
