// ============================================================
// pert/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

export async function exportPert(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState } = ctx;
  const { parsePert } = await import('./parser');
  const { analyzePert } = await import('./analyzer');
  const { layoutPert } = await import('./layout');
  const { renderPert, measurePertAnalysisBlock } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const pertParsed = parsePert(content, { palette: effectivePalette });
  if (pertParsed.error || pertParsed.activities.length === 0) return '';

  const pertResolved = analyzePert(pertParsed);
  const pertLayout = layoutPert(pertResolved);

  const hasTitle = !!pertParsed.title && !pertParsed.options.noTitle;
  // The project subtitle (μ ± σ, plus the anchor-derived date) is the
  // one line that answers "how long will this take". It is project-
  // level, so `no-title` suppresses the title and keeps it — it just
  // moves up into the title's slot. 80 with a title above it, 50 on
  // its own, 0 when the analyzer produced neither.
  const hasSubtitle = pertResolved.projectSubtitle !== null;
  const titleHeight = hasTitle ? 80 : hasSubtitle ? 50 : 0;
  const PERT_PADDING = 20;
  // Analysis layer renders by default whenever MC ran. Precedence:
  // an explicit viewState.an (app toggle / share link) wins; else the
  // `no-analysis` source directive suppresses it; else on. The
  // renderer silently omits it in analytical mode (no MC output).
  const analysisOn = viewState?.an ?? !pertParsed.options.noAnalysis;
  const fieldLabelsOn = viewState?.fl === true;
  const exportW = pertLayout.width + PERT_PADDING * 2;
  const analysisMeasured = measurePertAnalysisBlock(
    pertResolved,
    exportW - 2 * PERT_PADDING,
    {
      showTornado: analysisOn,
      showScurve: analysisOn,
      showFieldLegend: fieldLabelsOn,
    }
  );
  const exportH =
    pertLayout.height +
    PERT_PADDING * 2 +
    titleHeight +
    analysisMeasured.height;
  const container = createExportContainer(exportW, exportH);

  renderPert(
    container,
    pertResolved,
    pertLayout,
    effectivePalette,
    ctx.isDark,
    {
      title: hasTitle ? pertParsed.title : null,
      subtitle: pertResolved.projectSubtitle,
      exportDims: { width: exportW, height: exportH },
      showTornado: analysisOn,
      showScurve: analysisOn,
      showFieldLegend: fieldLabelsOn,
    }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
