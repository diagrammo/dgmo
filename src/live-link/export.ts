// ============================================================
// live-link/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import { resolveExportPalette } from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

/**
 * Live link — a pure-string card, so no export container and no
 * `finalizeSvgExport`. It renders even when the pointer is broken: the card is
 * the file's normal appearance, and an unresolvable id is the resolver's story
 * to tell, not a reason to hand back an empty string.
 */
export async function exportLiveLink(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseLiveLink } = await import('./parser');
  const { renderLiveLinkCard } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  return renderLiveLinkCard(parseLiveLink(content), effectivePalette, theme);
}
