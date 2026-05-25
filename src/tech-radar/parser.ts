import {
  formatDgmoError,
  makeDgmoError,
  METADATA_DIAGNOSTIC_CODES,
  pipeOperatorRemovedMessage,
  suggest,
} from '../diagnostics';
import { TECH_RADAR_REGISTRY } from '../utils/reserved-key-registry';
import {
  measureIndent,
  parseFirstLine,
  parsePipeMetadata,
  splitNameAndMeta,
  OPTION_NOCOLON_RE,
  warnUnknownMetaKeys,
} from '../utils/parsing';
import type { Writable } from '../utils/brand';
import type {
  ParsedTechRadar,
  TechRadarQuadrant,
  TechRadarBlip,
  QuadrantPosition,
  BlipTrend,
} from './types';

type WritableQuadrant = Omit<Writable<TechRadarQuadrant>, 'blips'> & {
  blips: Writable<TechRadarBlip>[];
};
type WritableResult = Omit<
  Writable<ParsedTechRadar>,
  'quadrants' | 'options'
> & {
  quadrants: WritableQuadrant[];
  options: Record<string, string>;
};

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
const KNOWN_BOOLEANS = new Set<string>([
  'show-blip-legend',
  'solid-fill',
  'no-title',
]);

export function parseTechRadar(content: string): ParsedTechRadar {
  const result: WritableResult = {
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

  if (!content?.trim()) {
    return fail(0, 'No content provided');
  }

  /** Check if a string matches a declared ring name or alias (case-insensitive). */
  function isRingName(name: string): boolean {
    const lower = name.toLowerCase();
    return result.rings.some(
      (r) =>
        r.name.toLowerCase() === lower ||
        (r.alias !== null && r.alias.toLowerCase() === lower)
    );
  }

  /** Get the canonical ring name for a case-insensitive match (by name or alias). */
  function canonicalRingName(name: string): string {
    const lower = name.toLowerCase();
    const ring = result.rings.find(
      (r) =>
        r.name.toLowerCase() === lower ||
        (r.alias !== null && r.alias.toLowerCase() === lower)
    );
    return ring?.name ?? name;
  }

  const lines = content.split('\n');
  let headerParsed = false;
  let inRingsBlock = false;
  let currentQuadrant: WritableQuadrant | null = null;
  let currentBlip: Writable<TechRadarBlip> | null = null;
  let blipBaseIndent = 0;
  let currentRing: string | null = null; // active ring section (new syntax)

  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard (i < lines.length).
    const line = lines[i]!;
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
      if (firstLine?.chartType === 'tech-radar') {
        result.title = firstLine.title ?? '';
        result.titleLineNumber = lineNumber;
        headerParsed = true;
        continue;
      }
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
      currentRing = null;
      continue;
    }

    if (inRingsBlock) {
      if (indent > 0) {
        // Parse ring declaration: `Name`, `Name alias a`, or `Name aka a`
        const aliasMatch = trimmed.match(/^(.+?)\s+(?:alias|aka)\s+(\S+)\s*$/i);
        if (aliasMatch) {
          result.rings.push({
            // Capture groups [1] and [2] guaranteed by regex match.
            name: aliasMatch[1]!.trim(),
            alias: aliasMatch[2]!.trim(),
            lineNumber,
          });
        } else {
          result.rings.push({ name: trimmed, alias: null, lineNumber });
        }
        continue;
      }
      inRingsBlock = false;
    }

    // --- Options (bare keyword or key value, top-level only) ---
    if (indent === 0 && !trimmed.includes('|')) {
      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (optMatch) {
        // Capture groups [1] and [2] guaranteed by OPTION_NOCOLON_RE shape.
        const key = optMatch[1]!.toLowerCase();
        if (KNOWN_OPTIONS.has(key)) {
          result.options[key] = optMatch[2]!.trim();
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

    // --- Quadrant section header: `Name quadrant: position` (§1.4) ---
    if (indent === 0 && /\bquadrant\s*:/.test(trimmed)) {
      // Legacy `|` detection.
      if (trimmed.includes('|')) {
        result.diagnostics.push(
          makeDgmoError(
            lineNumber,
            pipeOperatorRemovedMessage(),
            'error',
            METADATA_DIAGNOSTIC_CODES.PIPE_OPERATOR_REMOVED
          )
        );
      }
      // Support both: legacy `Name | quadrant: pos` AND new `Name quadrant: pos`.
      let segments: string[];
      let meta: Record<string, string>;
      if (trimmed.includes('|')) {
        segments = trimmed.split('|');
        meta = parsePipeMetadata(segments);
      } else {
        const split = splitNameAndMeta(
          trimmed,
          TECH_RADAR_REGISTRY,
          undefined,
          undefined,
          undefined,
          undefined,
          { peelAlias: false }
        );
        warnUnknownMetaKeys(
          split.meta,
          TECH_RADAR_REGISTRY,
          (msg) => warn(lineNumber, msg),
          split.name
        );
        segments = [split.name];
        meta = split.meta;
      }
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

        // In-bounds: split() always returns at least one element.
        const name = segments[0]!.trim();
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
        currentRing = null;
        continue;
      }
    }

    // --- Inside a quadrant ---
    if (currentQuadrant && indent > 0) {
      // --- Ring section header (new syntax): indented line matching a declared ring name ---
      if (
        !trimmed.includes('|') &&
        result.rings.length > 0 &&
        isRingName(trimmed)
      ) {
        currentRing = canonicalRingName(trimmed);
        currentBlip = null;
        continue;
      }

      // --- Description lines: indented deeper than current blip ---
      if (currentBlip && indent > blipBaseIndent) {
        currentBlip.description.push(trimmed);
        continue;
      }

      // --- Blip with same-line metadata (§1.4) ---
      if (
        trimmed.includes('|') ||
        /\b(?:ring|trend|color|description)\s*:/.test(trimmed)
      ) {
        // Legacy `|` detection.
        if (trimmed.includes('|')) {
          result.diagnostics.push(
            makeDgmoError(
              lineNumber,
              pipeOperatorRemovedMessage(),
              'error',
              METADATA_DIAGNOSTIC_CODES.PIPE_OPERATOR_REMOVED
            )
          );
        }
        let segments: string[];
        let meta: Record<string, string>;
        if (trimmed.includes('|')) {
          segments = trimmed.split('|');
          meta = parsePipeMetadata(segments);
        } else {
          const split = splitNameAndMeta(
            trimmed,
            TECH_RADAR_REGISTRY,
            undefined,
            undefined,
            undefined,
            undefined,
            { peelAlias: false }
          );
          warnUnknownMetaKeys(
            split.meta,
            TECH_RADAR_REGISTRY,
            (msg) => warn(lineNumber, msg),
            split.name
          );
          segments = [split.name];
          meta = split.meta;
        }

        // Determine ring: explicit `ring:` metadata overrides section ring
        const explicitRing = meta['ring'];
        const effectiveRing = explicitRing
          ? canonicalRingName(explicitRing)
          : currentRing;

        if (!effectiveRing) {
          result.diagnostics.push(
            makeDgmoError(
              lineNumber,
              `Blip "${segments[0]!.trim()}" has no ring assignment. Use a ring section header or add "ring: RingName" metadata.`
            )
          );
          continue;
        }

        // Validate ring name
        if (
          explicitRing &&
          result.rings.length > 0 &&
          !isRingName(explicitRing)
        ) {
          const hint = suggest(
            explicitRing,
            result.rings.map((r) => r.name)
          );
          let msg = `Unknown ring "${explicitRing}" on blip "${segments[0]!.trim()}"`;
          if (hint) msg += `. ${hint}`;
          result.diagnostics.push(makeDgmoError(lineNumber, msg));
          continue;
        }

        // Parse optional trend
        let trend: BlipTrend | null = null;
        if (meta['trend']) {
          const trendVal = meta['trend'].toLowerCase() as BlipTrend;
          if (!VALID_TRENDS.includes(trendVal)) {
            const hint = suggest(meta['trend'], [...VALID_TRENDS]);
            let msg = `Unknown trend "${meta['trend']}" on blip "${segments[0]!.trim()}". Must be one of: ${VALID_TRENDS.join(', ')}`;
            if (hint) msg += `. ${hint}`;
            result.diagnostics.push(makeDgmoError(lineNumber, msg, 'warning'));
          } else {
            trend = trendVal;
          }
        }

        currentBlip = {
          // In-bounds: split() always returns at least one element.
          name: segments[0]!.trim(),
          ring: effectiveRing,
          trend,
          description: [],
          lineNumber,
          globalNumber: 0,
        };
        blipBaseIndent = indent;
        currentQuadrant.blips.push(currentBlip);
        continue;
      }

      // --- Blip without pipe metadata (plain name, inherits ring from section) ---
      if (currentRing) {
        currentBlip = {
          name: trimmed,
          ring: currentRing,
          trend: null,
          description: [],
          lineNumber,
          globalNumber: 0,
        };
        blipBaseIndent = indent;
        currentQuadrant.blips.push(currentBlip);
        continue;
      }

      // No ring section and no pipe metadata — error
      result.diagnostics.push(
        makeDgmoError(
          lineNumber,
          `Blip "${trimmed}" has no ring assignment. Place it under a ring section header or use: ${trimmed} | ring: RingName`
        )
      );
      continue;
    }

    // --- Unrecognized top-level line ---
    if (indent === 0) {
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
function assignGlobalNumbers(result: WritableResult): void {
  const ringOrder = result.rings.map((r) => r.name);
  let counter = 1;

  for (const position of POSITION_ORDER) {
    const quadrant = result.quadrants.find((q) => q.position === position);
    if (!quadrant) continue;

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
