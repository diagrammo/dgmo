// ============================================================
// validate-diagram.ts — the one "is this diagram valid?" answer an agent gets.
//
// Two MCP servers ask it: dgmo-mcp's `validate_diagram`, and the desktop app's
// in-app endpoint (diagrammo/diagrammo#1266). It lives here so both say the
// same thing about the same source; it was written in dgmo-mcp first.
//
// It is stricter than the editor on two points, on purpose. An agent is told
// to regenerate on an error, so:
//   1. An invalid colour (hex, CSS name) blocks, even though the library
//      classes it a warning — named palette colours are mandatory.
//   2. A flowchart must be structurally sound: every decision has two or more
//      branches, and every node lies on a path from a start to an end.
// ============================================================

import { parseDgmoChartType } from './chart-type-detect';
import { INVALID_COLOR_CODE } from './colors';
import { formatDgmoError, type DgmoError } from './diagnostics';
import { parseDgmo } from './dgmo-router';
import { parseFlowchart } from './graph/flowchart-parser';
import { parseMap } from './map/parser';
import { resolveMap } from './map/resolver';
import type { MapData } from './map/resolved-types';

export const FLOWCHART_STRUCTURE_CODE = 'E_FLOWCHART_STRUCTURE';

function structureError(line: number, message: string): DgmoError {
  return { line, message, severity: 'error', code: FLOWCHART_STRUCTURE_CODE };
}

/**
 * Hard-error diagnostics for a flowchart that breaks the structural rules
 * above. Empty = structurally valid, or not enough graph to judge.
 */
export function validateFlowchartStructure(dgmo: string): DgmoError[] {
  let parsed: ReturnType<typeof parseFlowchart>;
  try {
    parsed = parseFlowchart(dgmo);
  } catch {
    return []; // the normal parse-error path reports a broken parse
  }

  const nodes = parsed.nodes ?? [];
  const edges = parsed.edges ?? [];
  if (nodes.length === 0 || edges.length === 0) return [];

  const out = new Map<string, string[]>();
  const inc = new Map<string, string[]>();
  for (const n of nodes) {
    out.set(n.id, []);
    inc.set(n.id, []);
  }
  for (const e of edges) {
    out.get(e.source)?.push(e.target);
    inc.get(e.target)?.push(e.source);
  }

  const issues: DgmoError[] = [];

  // Rule 1: every decision needs at least two outgoing branches.
  for (const n of nodes) {
    if (n.shape !== 'decision') continue;
    const branches = out.get(n.id)?.length ?? 0;
    if (branches < 2) {
      issues.push(
        structureError(
          n.lineNumber,
          `Decision "${n.label}" has ${branches === 0 ? 'no' : 'only one'} outgoing branch — a decision needs at least two (e.g. -yes-> / -no->, or specific labels like -retirement-> / -survivor->).`
        )
      );
    }
  }

  // Rule 2: every node lies on a start → end path. Start and end are topology,
  // not shape: a flowchart without `()` terminals must not be rejected.
  const starts = nodes.filter(
    (n) =>
      (inc.get(n.id)?.length ?? 0) === 0 && (out.get(n.id)?.length ?? 0) > 0
  );
  const ends = nodes.filter(
    (n) =>
      (out.get(n.id)?.length ?? 0) === 0 && (inc.get(n.id)?.length ?? 0) > 0
  );

  if (starts.length === 0) {
    issues.push(
      structureError(
        0,
        'Flowchart has no entry point — every node has an incoming arrow, so the flow loops with no start. Add a start node that nothing points to.'
      )
    );
  }
  if (ends.length === 0) {
    issues.push(
      structureError(
        0,
        'Flowchart has no end — every node has an outgoing arrow, so the flow never stops. Add a terminal node where the flow ends.'
      )
    );
  }

  // Per-node reachability only means something once a start AND an end exist.
  if (starts.length > 0 && ends.length > 0) {
    const forward = reach(
      starts.map((n) => n.id),
      out
    );
    const backward = reach(
      ends.map((n) => n.id),
      inc
    );
    for (const n of nodes) {
      if (!forward.has(n.id) || !backward.has(n.id)) {
        issues.push(
          structureError(
            n.lineNumber,
            `Node "${n.label}" is not connected to the flow — it must lie on a path from the start to an end. Wire it into the diagram or remove it.`
          )
        );
      }
    }
  }

  return issues;
}

function reach(seeds: string[], adj: Map<string, string[]>): Set<string> {
  const seen = new Set<string>(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const next of adj.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

export interface DiagramValidation {
  chartType: string | null;
  /** Blocking: severity `error`, plus every invalid colour. */
  errors: DgmoError[];
  warnings: DgmoError[];
}

export interface ValidateDiagramOptions {
  /**
   * Map data, for `map` sources. Place names, routes and references are
   * resolved (and errored) only by `resolveMap`; without it a map is checked
   * by the parser alone, which misses an unknown place. Supplied by the host
   * because loading it differs between Node and the browser.
   */
  mapData?: MapData;
}

/** Every diagnostic an agent should hear about, split into blocking and not. */
export function validateDiagram(
  source: string,
  options: ValidateDiagramOptions = {}
): DiagramValidation {
  const chartType = parseDgmoChartType(source);
  let diagnostics: DgmoError[];
  if (chartType === 'map' && options.mapData) {
    try {
      // resolveMap seeds its list with the parse diagnostics, so it is the
      // complete set.
      diagnostics = resolveMap(
        parseMap(source),
        options.mapData
      ).diagnostics.slice();
    } catch {
      diagnostics = parseDgmo(source).diagnostics.slice();
    }
  } else {
    diagnostics = parseDgmo(source).diagnostics.slice();
  }
  if (chartType === 'flowchart') {
    diagnostics.push(...validateFlowchartStructure(source));
  }
  const blocking = (d: DgmoError) =>
    d.severity === 'error' || d.code === INVALID_COLOR_CODE;
  return {
    chartType,
    errors: diagnostics.filter(blocking),
    warnings: diagnostics.filter((d) => !blocking(d)),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** The text both MCP servers return, and whether it is an error result. */
export function formatDiagramValidation(v: DiagramValidation): {
  text: string;
  isError: boolean;
} {
  const { chartType, errors, warnings } = v;
  if (errors.length === 0 && warnings.length === 0) {
    return {
      text: `Valid ${chartType ? `${chartType} diagram` : 'diagram'} — no errors or warnings.`,
      isError: false,
    };
  }

  const typeLabel = chartType ? ` in ${chartType} diagram` : '';
  const parts: string[] = [];
  if (errors.length > 0) {
    parts.push(
      `${plural(errors.length, 'error')}${warnings.length > 0 ? `, ${plural(warnings.length, 'warning')}` : ''}${typeLabel}\n`
    );
    parts.push('Errors:');
    for (const e of errors) parts.push(`  ${formatDgmoError(e)}`);
  }
  if (warnings.length > 0) {
    if (errors.length === 0) {
      parts.push(
        `Valid with ${plural(warnings.length, 'warning')}${typeLabel}\n`
      );
    } else {
      parts.push('');
    }
    parts.push('Warnings:');
    for (const w of warnings) parts.push(`  ${formatDgmoError(w)}`);
  }
  return { text: parts.join('\n'), isError: errors.length > 0 };
}
