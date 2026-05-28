export type TimelineSort = 'time' | 'group' | 'tag';

export interface TimelineEvent {
  date: string;
  endDate: string | null;
  label: string;
  group: string | null;
  metadata: Record<string, string>;
  lineNumber: number;
  uncertain?: boolean;
}

export interface TimelineGroup {
  name: string;
  color: string | null;
  metadata: Record<string, string>;
  lineNumber: number;
}

export interface TimelineEra {
  startDate: string;
  endDate: string;
  label: string;
  color: string | null;
  lineNumber: number;
}

export interface TimelineMarker {
  date: string;
  label: string;
  color: string | null;
  lineNumber: number;
}
