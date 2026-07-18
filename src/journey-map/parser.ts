import type { PaletteColors } from '../palettes';
import { resolveColorWithDiagnostic } from '../colors';
import {
  formatDgmoError,
  makeDgmoError,
  makeFail,
  suggest,
} from '../diagnostics';
import {
  JOURNEY_MAP_REGISTRY,
  withTagAliases,
} from '../utils/reserved-key-registry';
import {
  splitNameAndMeta,
  warnUnknownMetaKeys,
  peelTrailingColorName,
} from '../utils/parsing';
import {
  matchTagBlockHeading,
  stripDefaultModifier,
  validateTagGroupNames,
  finalizeAutoTagColors,
  AUTO_TAG_COLOR_SENTINEL,
  tagAttrKey,
} from '../utils/tag-groups';
import {
  measureIndent,
  extractColor,
  parseFirstLine,
  OPTION_NOCOLON_RE,
} from '../utils/parsing';
import { tryStripDescriptionKeyword } from '../utils/description-helpers';
import type {
  ParsedJourneyMap,
  JourneyMapPhase,
  JourneyMapStep,
  JourneyMapPersona,
  JourneyMapAnnotation,
} from './types';
import type { TagGroup } from '../utils/tag-groups';
import type { Writable } from '../utils/brand';

// ============================================================
// Regex patterns
// ============================================================

const PHASE_RE = /^\[(.+?)\]$/;
const ANNOTATION_RE = /^(pain|opportunity|thought)\s*:\s*(.+)$/i;

/** Known journey-map options (key-value). */
const KNOWN_OPTIONS = new Set(['active-tag']);
/** Known journey-map boolean options (bare keyword = on). */
const KNOWN_BOOLEANS = new Set([
  'fill-tint',
  'fill-solid',
  'fill-outline',
  'no-title',
  'no-legend',
]);

// ============================================================
// Parser
// ============================================================

export function parseJourneyMap(
  content: string,
  palette?: PaletteColors
): ParsedJourneyMap {
  const options: Record<string, string> = {};
  const result: Writable<ParsedJourneyMap> = {
    type: 'journey-map',
    phases: [],
    steps: [],
    tagGroups: [],
    options,
    diagnostics: [],
    error: null,
  };

  const fail = makeFail(result);

  const warn = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  if (!content?.trim()) {
    return fail(0, 'No content provided');
  }

  const lines = content.split('\n');
  let contentStarted = false;
  let currentTagGroup: Writable<TagGroup> | null = null;
  let inPersona = false;
  let currentPhase: Writable<JourneyMapPhase> | null = null;
  let currentStep: Writable<JourneyMapStep> | null = null;
  let currentPersona: Writable<JourneyMapPersona> | null = null;
  let stepBaseIndent = 0;
  let phaseCounter = 0;
  let stepCounter = 0;
  let hasPhases = false;

  const aliasMap = new Map<string, string>();
  const tagValueSets = new Map<string, Set<string>>();

  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const line = lines[i]!;
    const lineNumber = i + 1;
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      if (currentTagGroup) currentTagGroup = null;
      if (inPersona) inPersona = false;
      continue;
    }

    // Skip comments
    if (trimmed.startsWith('//')) continue;

    const indent = measureIndent(line);

    // --- Header phase ---

    // Extract chart type + title from first line
    if (!contentStarted && !currentTagGroup && !inPersona) {
      const firstLine = parseFirstLine(trimmed);
      if (firstLine) {
        if (firstLine.chartType !== 'journey-map') {
          const allTypes = ['journey-map', 'kanban', 'sequence', 'flowchart'];
          let msg = `Expected chart type "journey-map", got "${firstLine.chartType}"`;
          const hint = suggest(firstLine.chartType, allTypes);
          if (hint) msg += `. ${hint}`;
          return fail(lineNumber, msg);
        }
        if (firstLine.title) {
          result.title = firstLine.title;
          result.titleLineNumber = lineNumber;
        }
        continue;
      }
    }

    // Persona keyword
    if (!contentStarted && !currentTagGroup && indent === 0) {
      const personaMatch = trimmed.match(/^persona\s+(.+)$/i);
      if (personaMatch) {
        // Capture group 1 present by regex shape.
        const afterKeyword = personaMatch[1]!.trim();
        let personaName: string;
        let personaColor: string | undefined;

        // Same-line form (pipes removed in 0.18.0). Two ways to set color:
        //   1. explicit `persona <name> color: <token>` (long form)
        //   2. universal §1.5 trailing-token color (`persona <name> green`);
        //      capitalize the word (`Green`) to keep it as literal name text.
        const colorMatch = afterKeyword.match(/^(.+?)\s+color:\s*(\S+)$/i);
        if (colorMatch) {
          personaName = colorMatch[1]!.trim();
          personaColor =
            resolveColorWithDiagnostic(
              colorMatch[2]!,
              lineNumber,
              result.diagnostics,
              palette
            ) ?? undefined;
        } else {
          const { label, colorName } = peelTrailingColorName(afterKeyword);
          if (colorName) {
            personaName = label;
            personaColor =
              resolveColorWithDiagnostic(
                colorName,
                lineNumber,
                result.diagnostics,
                palette
              ) ?? undefined;
          } else {
            personaName = afterKeyword;
          }
        }

        if (!personaName) {
          return fail(lineNumber, 'persona requires a name');
        }

        currentPersona = {
          name: personaName,
          ...(personaColor !== undefined && { color: personaColor }),
          lineNumber,
        };
        result.persona = currentPersona;
        inPersona = true;
        continue;
      }
      if (/^persona\s*$/i.test(trimmed)) {
        return fail(lineNumber, 'persona requires a name');
      }
    }

    // Persona description (indented lines while inPersona)
    if (inPersona && indent > 0) {
      if (currentPersona) {
        currentPersona.description = currentPersona.description
          ? currentPersona.description + '\n' + trimmed
          : trimmed;
      }
      continue;
    }

    // End persona on non-indented line
    if (inPersona && indent === 0) {
      inPersona = false;
    }

    // Tag group heading
    if (!contentStarted) {
      const tagBlockMatch = matchTagBlockHeading(trimmed);
      if (tagBlockMatch) {
        currentTagGroup = {
          name: tagBlockMatch.name,
          ...(tagBlockMatch.alias !== undefined && {
            alias: tagBlockMatch.alias,
          }),
          entries: [],
          lineNumber,
        };
        if (tagBlockMatch.alias) {
          aliasMap.set(
            tagBlockMatch.alias.toLowerCase(),
            tagAttrKey(tagBlockMatch.name)
          );
        }
        aliasMap.set(
          tagAttrKey(tagBlockMatch.name),
          tagAttrKey(tagBlockMatch.name)
        );
        result.tagGroups.push(currentTagGroup);
        continue;
      }
    }

    // Tag group entries (indented under tag heading)
    if (currentTagGroup && !contentStarted) {
      if (indent > 0) {
        const { text: cleanEntry, isDefault } = stripDefaultModifier(trimmed);
        const { label, color } = extractColor(
          cleanEntry,
          palette,
          result.diagnostics,
          lineNumber
        );
        // Bare value (no explicit color) → keep it; finalized below.
        if (isDefault) {
          currentTagGroup.defaultValue = label;
        } else if (currentTagGroup.entries.length === 0) {
          currentTagGroup.defaultValue = label;
        }
        currentTagGroup.entries.push({
          value: label,
          color: color ?? AUTO_TAG_COLOR_SENTINEL,
          lineNumber,
        });
        continue;
      }
      currentTagGroup = null;
    }

    // Generic header options
    if (!contentStarted && !currentTagGroup && indent === 0) {
      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (optMatch && !PHASE_RE.test(trimmed)) {
        // Capture groups 1 and 2 present by regex shape.
        const key = optMatch[1]!.trim().toLowerCase();
        if (KNOWN_OPTIONS.has(key)) {
          options[key] = optMatch[2]!.trim();
          continue;
        }
      }
      if (
        KNOWN_BOOLEANS.has(trimmed.toLowerCase()) &&
        !PHASE_RE.test(trimmed)
      ) {
        options[trimmed.toLowerCase()] = 'on';
        continue;
      }
    }

    // --- Content phase detection ---

    // Phase header at indent 0
    const phaseMatch = indent === 0 ? trimmed.match(PHASE_RE) : null;
    if (phaseMatch) {
      contentStarted = true;
      currentTagGroup = null;
      inPersona = false;
      hasPhases = true;

      // Finalize previous step
      if (currentStep) {
        currentStep.endLineNumber = lineNumber - 1;
      }
      currentStep = null;

      phaseCounter++;
      currentPhase = {
        id: `phase-${phaseCounter}`,
        // Capture group 1 present by regex shape.
        name: phaseMatch[1]!.trim(),
        steps: [],
        lineNumber,
      };
      result.phases.push(currentPhase);
      continue;
    }

    // Flat mode: indent-0 line that is not a phase/keyword — check if step
    if (indent === 0 && !contentStarted) {
      // Check if this looks like a step (contains pipe or is a bare step name)
      if (
        trimmed.includes('|') ||
        (!KNOWN_OPTIONS.has(trimmed.toLowerCase()) &&
          !KNOWN_BOOLEANS.has(trimmed.toLowerCase()))
      ) {
        contentStarted = true;
      }
    }

    // --- Content phase ---

    if (!contentStarted) continue;

    // Mixed mode check: indent-0 non-phase line when phases exist
    if (indent === 0 && hasPhases && !phaseMatch) {
      // Stray line between phases
      if (trimmed.includes('|') || !PHASE_RE.test(trimmed)) {
        warn(
          lineNumber,
          `Step "${trimmed}" sits outside any phase and is ignored — indent it under a '[Phase]' header (per §22).`
        );
        continue;
      }
    }

    // Annotations/description on current step (deeper indent)
    if (currentStep && indent > stepBaseIndent) {
      // Check for annotation keywords
      const annoMatch = trimmed.match(ANNOTATION_RE);
      if (annoMatch) {
        // Capture groups 1 and 2 present by regex shape.
        currentStep.annotations.push({
          type: annoMatch[1]!.toLowerCase() as JourneyMapAnnotation['type'],
          text: annoMatch[2]!.trim(),
        });
        currentStep.endLineNumber = lineNumber;
        continue;
      }

      // Check for description keyword
      const descResult = tryStripDescriptionKeyword(trimmed);
      if (descResult.isKeyword) {
        currentStep.description = descResult.text;
        currentStep.endLineNumber = lineNumber;
        continue;
      }

      // Unknown deeper-indented line — treat as detail, skip silently
      currentStep.endLineNumber = lineNumber;
      continue;
    }

    // Step line (indented under phase, or indent-0 in flat mode)
    if ((currentPhase && indent > 0) || (!hasPhases && indent === 0)) {
      // Finalize previous step
      if (currentStep) {
        currentStep.endLineNumber = lineNumber - 1;
      }

      stepCounter++;
      const step = parseStepLine(
        trimmed,
        lineNumber,
        stepCounter,
        aliasMap,
        warn,
        result.diagnostics
      );
      stepBaseIndent = indent;
      currentStep = step;

      if (currentPhase) {
        currentPhase.steps.push(step);
      } else {
        result.steps.push(step);
      }
      continue;
    }

    // Unrecognized line
    if (indent > 0 && !currentPhase && hasPhases) {
      warn(
        lineNumber,
        `Indented line outside any phase — add a '[Phase]' header above it, or unindent it to a top-level step. (§22)`
      );
    }
  }

  // Finalize last step
  if (currentStep) {
    currentStep.endLineNumber = lines.length;
  }

  // --- Post-parse validation ---

  // Build tag value sets
  for (const group of result.tagGroups) {
    const values = new Set(group.entries.map((e) => e.value.toLowerCase()));
    tagValueSets.set(tagAttrKey(group.name), values);
  }

  // Validate tag values on all steps
  const allSteps = hasPhases
    ? result.phases.flatMap((p) => p.steps)
    : result.steps;

  for (const step of allSteps) {
    for (const [tagKey, tagValue] of Object.entries(step.tags)) {
      const groupKey =
        aliasMap.get(tagKey.toLowerCase()) ?? tagKey.toLowerCase();
      const validValues = tagValueSets.get(groupKey);
      if (validValues && !validValues.has(tagValue.toLowerCase())) {
        const entries = result.tagGroups
          .find((g) => g.name.toLowerCase() === groupKey)
          ?.entries.map((e) => e.value);
        let msg = `Unknown tag value "${tagValue}" for group "${groupKey}"`;
        if (entries) {
          const hint = suggest(tagValue, entries);
          if (hint) msg += `. ${hint}`;
        }
        warn(step.lineNumber, msg);
      }
    }

    // Hint for missing scores
    if (step.score === undefined) {
      warn(
        step.lineNumber,
        `Step "${step.title}" has no score — it will not appear on the emotion curve`
      );
    }
  }

  // No content check
  if (
    result.phases.length === 0 &&
    result.steps.length === 0 &&
    !result.error
  ) {
    return fail(1, 'No phases or steps found');
  }

  // Assign palette colors to bare (colorless) tag values.
  finalizeAutoTagColors(result.tagGroups as Writable<TagGroup>[], palette);

  validateTagGroupNames(result.tagGroups, warn, (line, msg) => {
    const diag = makeDgmoError(line, msg);
    result.diagnostics.push(diag);
    if (!result.error) result.error = formatDgmoError(diag);
  });

  return result;
}

// ============================================================
// Step line parser
// ============================================================

function parseStepLine(
  trimmed: string,
  lineNumber: number,
  counter: number,
  aliasMap: Map<string, string>,
  warn: (line: number, message: string) => void,
  diagnostics?: import('../diagnostics').DgmoError[]
): Writable<JourneyMapStep> {
  let score: number | undefined;
  let emotionLabel: string | undefined;
  const tags: Record<string, string> = {};

  // §1.4 unified metadata grammar — same-line form; use splitNameAndMeta to
  // extract `score:`, `emotion:`, and any other reserved/tag-alias keys.
  const registry = withTagAliases(
    JOURNEY_MAP_REGISTRY,
    new Set(aliasMap.keys())
  );
  const split = splitNameAndMeta(
    trimmed,
    registry,
    aliasMap,
    undefined,
    diagnostics,
    lineNumber
  );
  warnUnknownMetaKeys(
    split.meta,
    registry,
    (msg) => warn(lineNumber, msg),
    split.name
  );
  const title = split.name;
  const splitMeta = { ...split.meta };
  // Extract reserved score / emotion into the dedicated fields.
  if ('score' in splitMeta) {
    const scoreVal = splitMeta['score'];
    delete splitMeta['score'];
    const parsed = parseInt(scoreVal, 10);
    if (
      !isNaN(parsed) &&
      scoreVal === String(parsed) &&
      parsed >= 1 &&
      parsed <= 5
    ) {
      score = parsed;
    } else if (!isNaN(parsed) && (parsed < 1 || parsed > 5)) {
      warn(lineNumber, `Score out of range: ${parsed} (must be 1-5)`);
    } else {
      warn(lineNumber, `Score must be an integer 1-5, got ${scoreVal}`);
    }
  }
  if ('emotion' in splitMeta) {
    const emotionVal = splitMeta['emotion'];
    delete splitMeta['emotion'];
    if (emotionVal.includes(' ')) {
      warn(
        lineNumber,
        `Emotion label must be a single word — got "${emotionVal}"`
      );
    } else {
      emotionLabel = emotionVal;
    }
  }
  Object.assign(tags, splitMeta);

  return {
    id: `step-${counter}`,
    title,
    ...(score !== undefined && { score }),
    ...(emotionLabel !== undefined && { emotionLabel }),
    tags,
    annotations: [],
    lineNumber,
    endLineNumber: lineNumber,
  };
}
