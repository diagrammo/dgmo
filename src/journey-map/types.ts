import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';

export interface JourneyMapAnnotation {
  readonly type: 'pain' | 'opportunity' | 'thought';
  readonly text: string;
}

export interface JourneyMapStep {
  readonly id: string;
  readonly title: string;
  readonly score?: number;
  readonly emotionLabel?: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly annotations: readonly JourneyMapAnnotation[];
  readonly description?: string;
  readonly lineNumber: number;
  readonly endLineNumber: number;
}

export interface JourneyMapPhase {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly JourneyMapStep[];
  readonly lineNumber: number;
}

export interface JourneyMapPersona {
  readonly name: string;
  readonly description?: string;
  readonly color?: string;
  readonly lineNumber: number;
}

export interface ParsedJourneyMap {
  readonly type: 'journey-map';
  readonly title?: string;
  readonly titleLineNumber?: number;
  readonly persona?: JourneyMapPersona;
  readonly phases: readonly JourneyMapPhase[];
  /** Flat-mode steps (not inside any phase) */
  readonly steps: readonly JourneyMapStep[];
  readonly tagGroups: readonly TagGroup[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
