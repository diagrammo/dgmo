// ============================================================
// sequence/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import { ctxTagOverride, type ExportContext } from '../utils/export-context';
import { parseVisualization } from '../visualizations/parse';

/**
 * Fallthrough export for `sequence` — the only type without a chart-type of its
 * own (auto-detected from arrow syntax, parsed by parseSequenceDgmo). All other
 * D3 visualizations now have their own handler in DIAGRAM_EXPORT_HANDLERS.
 */
export async function exportVisualization(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState } = ctx;
  const parsed = parseVisualization(content, palette);
  // Allow sequence diagrams through even if parseVisualization errors —
  // sequence is parsed by its own dedicated parser (parseSequenceDgmo)
  // and may not have a "chart:" line (auto-detected from arrow syntax).
  if (parsed.type !== 'sequence') {
    if (parsed.error) {
      const looksLikeSequence = /->|~>|<-/.test(content);
      if (!looksLikeSequence) return '';
    } else {
      return '';
    }
  }

  const effectivePalette = await resolveExportPalette(theme, palette);
  const isDark = ctx.isDark;
  const container = createExportContainer(ctx.width, ctx.height);

  const { parseSequenceDgmo } = await import('./parser');
  const { renderSequenceDiagram } = await import('./renderer');
  const seqParsed = parseSequenceDgmo(content, effectivePalette);
  if (seqParsed.error || seqParsed.participants.length === 0) return '';
  // Apply interactive view state from share links (read from unified viewState).
  // Sequences key both sections and groups by source line number; `cg` is the
  // shared string[] field, so coerce its entries back to numbers.
  const {
    unionCollapsedSequenceNotes,
    collapsedSequenceSectionLinesFromSource,
  } = await import('./collapse');
  // Folded sections = source markers ∪ a share link's `cs` (#1741).
  const collapsedSections = collapsedSequenceSectionLinesFromSource(seqParsed);
  for (const line of viewState?.cs ?? []) collapsedSections.add(line);
  const collapsedGroups = viewState?.cg
    ? new Set(viewState.cg.map(Number).filter((n) => Number.isFinite(n)))
    : undefined;
  // Folded notes = source markers ∪ runtime lines (#1741). Notes and groups
  // are both keyed by source line, so a share link's `cg` carries note lines
  // too; a line that is not a foldable note's opening line is ignored.
  const collapsedNotes = unionCollapsedSequenceNotes(
    seqParsed,
    viewState?.cg?.map(Number).filter((n) => Number.isFinite(n))
  );
  const seqActiveTagGroup = ctxTagOverride(ctx);
  renderSequenceDiagram(
    container,
    seqParsed,
    effectivePalette,
    isDark,
    undefined,
    {
      exportWidth: ctx.width,
      ...(seqActiveTagGroup !== undefined && {
        activeTagGroup: seqActiveTagGroup,
      }),
      ...(collapsedSections.size > 0 && { collapsedSections }),
      ...(collapsedGroups !== undefined && { collapsedGroups }),
      collapsedNotes,
    }
  );

  return finalizeSvgExport(container, theme, effectivePalette);
}
