import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';

export interface JourneyMapAnnotation {
  type: 'pain' | 'opportunity' | 'thought';
  text: string;
}

export interface JourneyMapStep {
  id: string;
  title: string;
  score?: number;
  emotionLabel?: string;
  tags: Record<string, string>;
  annotations: JourneyMapAnnotation[];
  description?: string;
  lineNumber: number;
  endLineNumber: number;
}

export interface JourneyMapPhase {
  id: string;
  name: string;
  steps: JourneyMapStep[];
  lineNumber: number;
}

export interface JourneyMapPersona {
  name: string;
  description?: string;
  color?: string;
  lineNumber: number;
}

export interface ParsedJourneyMap {
  type: 'journey-map';
  title?: string;
  titleLineNumber?: number;
  persona?: JourneyMapPersona;
  phases: JourneyMapPhase[];
  /** Flat-mode steps (not inside any phase) */
  steps: JourneyMapStep[];
  tagGroups: TagGroup[];
  options: Record<string, string>;
  diagnostics: DgmoError[];
  error: string | null;
}
