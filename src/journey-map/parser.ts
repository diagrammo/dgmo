import type { PaletteColors } from '../palettes';
import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import {
  matchTagBlockHeading,
  stripDefaultModifier,
  validateTagGroupNames,
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
  JourneyMapAnnotation,
} from './types';
import type { TagGroup } from '../utils/tag-groups';

// ============================================================
// Regex patterns
// ============================================================

const PHASE_RE = /^\[(.+?)\]$/;
const SCORE_RE = /^(\d+(?:\.\d+)?)(?:\s+([A-Za-z]\w*))?$/;
const ANNOTATION_RE = /^(pain|opportunity|thought)\s*:\s*(.+)$/i;

/** Known journey-map options (key-value). */
const KNOWN_OPTIONS = new Set(['active-tag']);
/** Known journey-map boolean options (bare keyword = on). */
const KNOWN_BOOLEANS = new Set(['no-legend', 'solid-fill']);

// ============================================================
// Parser
// ============================================================

export function parseJourneyMap(
  content: string,
  palette?: PaletteColors
): ParsedJourneyMap {
  const result: ParsedJourneyMap = {
    type: 'journey-map',
    phases: [],
    steps: [],
    tagGroups: [],
    options: {},
    diagnostics: [],
    error: null,
  };

  const fail = (line: number, message: string): ParsedJourneyMap => {
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
  let contentStarted = false;
  let currentTagGroup: TagGroup | null = null;
  let inPersona = false;
  let currentPhase: JourneyMapPhase | null = null;
  let currentStep: JourneyMapStep | null = null;
  let stepBaseIndent = 0;
  let phaseCounter = 0;
  let stepCounter = 0;
  let hasPhases = false;

  const aliasMap = new Map<string, string>();
  const tagValueSets = new Map<string, Set<string>>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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
        const afterKeyword = personaMatch[1].trim();
        const pipeIdx = afterKeyword.indexOf('|');
        let personaName: string;
        let personaColor: string | undefined;

        if (pipeIdx >= 0) {
          personaName = afterKeyword.substring(0, pipeIdx).trim();
          const metaStr = afterKeyword.substring(pipeIdx + 1).trim();
          // Parse comma-separated key: value pairs
          for (const part of metaStr.split(',')) {
            const colonIdx = part.indexOf(':');
            if (colonIdx > 0) {
              const key = part.substring(0, colonIdx).trim().toLowerCase();
              const value = part.substring(colonIdx + 1).trim();
              if (key === 'color') {
                const resolved = extractColor(`x(${value})`, palette);
                personaColor = resolved.color;
              }
            }
          }
        } else {
          personaName = afterKeyword;
        }

        if (!personaName) {
          return fail(lineNumber, 'persona requires a name');
        }

        result.persona = {
          name: personaName,
          color: personaColor,
          lineNumber,
        };
        inPersona = true;
        continue;
      }
      if (/^persona\s*$/i.test(trimmed)) {
        return fail(lineNumber, 'persona requires a name');
      }
    }

    // Persona description (indented lines while inPersona)
    if (inPersona && indent > 0) {
      if (result.persona) {
        result.persona.description = result.persona.description
          ? result.persona.description + '\n' + trimmed
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
          alias: tagBlockMatch.alias,
          entries: [],
          lineNumber,
        };
        if (tagBlockMatch.alias) {
          aliasMap.set(
            tagBlockMatch.alias.toLowerCase(),
            tagBlockMatch.name.toLowerCase()
          );
        }
        result.tagGroups.push(currentTagGroup);
        continue;
      }
    }

    // Tag group entries (indented under tag heading)
    if (currentTagGroup && !contentStarted) {
      if (indent > 0) {
        const { text: cleanEntry, isDefault } = stripDefaultModifier(trimmed);
        const { label, color } = extractColor(cleanEntry, palette);
        if (!color) {
          warn(
            lineNumber,
            `Expected 'Value(color)' in tag group '${currentTagGroup.name}'`
          );
          continue;
        }
        if (isDefault) {
          currentTagGroup.defaultValue = label;
        } else if (currentTagGroup.entries.length === 0) {
          currentTagGroup.defaultValue = label;
        }
        currentTagGroup.entries.push({ value: label, color, lineNumber });
        continue;
      }
      currentTagGroup = null;
    }

    // Generic header options
    if (!contentStarted && !currentTagGroup && indent === 0) {
      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (optMatch && !PHASE_RE.test(trimmed)) {
        const key = optMatch[1].trim().toLowerCase();
        if (KNOWN_OPTIONS.has(key)) {
          result.options[key] = optMatch[2].trim();
          continue;
        }
      }
      if (
        KNOWN_BOOLEANS.has(trimmed.toLowerCase()) &&
        !PHASE_RE.test(trimmed)
      ) {
        result.options[trimmed.toLowerCase()] = 'on';
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
        name: phaseMatch[1].trim(),
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
          'Steps outside phases will be ignored when phases are present'
        );
        continue;
      }
    }

    // Annotations/description on current step (deeper indent)
    if (currentStep && indent > stepBaseIndent) {
      // Check for annotation keywords
      const annoMatch = trimmed.match(ANNOTATION_RE);
      if (annoMatch) {
        currentStep.annotations.push({
          type: annoMatch[1].toLowerCase() as JourneyMapAnnotation['type'],
          text: annoMatch[2].trim(),
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
        warn
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
      warn(lineNumber, `Unexpected indented line outside of a phase`);
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
    tagValueSets.set(group.name.toLowerCase(), values);
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
  warn: (line: number, message: string) => void
): JourneyMapStep {
  const pipeIdx = trimmed.indexOf('|');
  let title: string;
  let score: number | undefined;
  let emotionLabel: string | undefined;
  const tags: Record<string, string> = {};

  if (pipeIdx >= 0) {
    title = trimmed.substring(0, pipeIdx).trim();
    const pipeContent = trimmed.substring(pipeIdx + 1).trim();

    if (pipeContent) {
      // Split on first comma to isolate potential score segment
      const commaIdx = pipeContent.indexOf(',');
      const firstSegment =
        commaIdx >= 0
          ? pipeContent.substring(0, commaIdx).trim()
          : pipeContent.trim();
      const restSegments =
        commaIdx >= 0 ? pipeContent.substring(commaIdx + 1).trim() : '';

      const scoreMatch = firstSegment.match(SCORE_RE);

      if (scoreMatch) {
        const rawScore = scoreMatch[1];
        const label = scoreMatch[2];

        if (rawScore.includes('.')) {
          // Float — reject
          warn(lineNumber, `Score must be an integer 1-5, got ${rawScore}`);
        } else {
          const intScore = parseInt(rawScore, 10);
          if (intScore < 1 || intScore > 5) {
            warn(lineNumber, `Score out of range: ${intScore} (must be 1-5)`);
          } else {
            score = intScore;
            emotionLabel = label;
          }
        }

        // Parse remaining metadata
        if (restSegments) {
          const metaParts = restSegments.split(',');
          for (const part of metaParts) {
            const colonIdx = part.indexOf(':');
            if (colonIdx > 0) {
              const rawKey = part.substring(0, colonIdx).trim().toLowerCase();
              const key = aliasMap.get(rawKey) ?? rawKey;
              const value = part.substring(colonIdx + 1).trim();
              tags[key] = value;
            }
          }
        }
      } else {
        // First segment didn't match score regex
        // Check if it's a multi-word emotion label attempt (number followed by multiple words)
        const multiWordCheck = firstSegment.match(/^(\d+)\s+(.+)$/);
        if (multiWordCheck && multiWordCheck[2].includes(' ')) {
          // Preserve the score but warn about the multi-word label
          const mwScore = parseInt(multiWordCheck[1], 10);
          if (mwScore >= 1 && mwScore <= 5) {
            score = mwScore;
          }
          warn(
            lineNumber,
            `Emotion label must be a single word — got "${multiWordCheck[2]}"`
          );
        }

        // Treat entire pipe content as standard metadata
        const allParts = pipeContent.split(',');
        for (const part of allParts) {
          const colonIdx = part.indexOf(':');
          if (colonIdx > 0) {
            const rawKey = part.substring(0, colonIdx).trim().toLowerCase();
            const key = aliasMap.get(rawKey) ?? rawKey;
            const value = part.substring(colonIdx + 1).trim();
            tags[key] = value;
          }
        }

        // Check for explicit score: key
        if ('score' in tags) {
          const scoreVal = tags['score'];
          delete tags['score'];
          const parsed = parseInt(scoreVal, 10);
          if (isNaN(parsed) || scoreVal !== String(parsed)) {
            warn(
              lineNumber,
              `Invalid score value: "${scoreVal}" (must be an integer 1-5)`
            );
          } else if (parsed < 1 || parsed > 5) {
            warn(lineNumber, `Score out of range: ${parsed} (must be 1-5)`);
          } else {
            score = parsed;
          }
        }
      }
    }
  } else {
    title = trimmed;
    // No pipe — scoreless step
  }

  return {
    id: `step-${counter}`,
    title,
    score,
    emotionLabel,
    tags,
    annotations: [],
    lineNumber,
    endLineNumber: lineNumber,
  };
}
