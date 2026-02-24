import { FONT_FAMILY } from './fonts';

const BRANDING_HEIGHT = 20;

/**
 * Injects `diagrammo.app` branding text into an SVG string.
 * Extends the SVG height by 20px and places the text at the bottom-right.
 */
export function injectBranding(svgHtml: string, mutedColor: string): string {
  if (!svgHtml) return svgHtml;

  const brandingText = `<text x="0" y="0" font-size="10" font-family="${FONT_FAMILY}" fill="${mutedColor}" opacity="0.5" text-anchor="end">diagrammo.app</text>`;

  // Parse viewBox
  const vbMatch = svgHtml.match(/viewBox="([^"]+)"/);
  const heightAttrMatch = svgHtml.match(/height="([^"]+)"/);

  if (vbMatch) {
    const parts = vbMatch[1].split(/\s+/).map(Number);
    if (parts.length === 4) {
      const [vx, vy, vw, vh] = parts;
      const newVh = vh + BRANDING_HEIGHT;
      const textX = vx + vw - 4;
      const textY = vy + vh + BRANDING_HEIGHT - 6;
      const positioned = brandingText.replace('x="0" y="0"', `x="${textX}" y="${textY}"`);

      let result = svgHtml.replace(
        /viewBox="[^"]+"/,
        `viewBox="${vx} ${vy} ${vw} ${newVh}"`
      );

      // Update height attribute if present
      if (heightAttrMatch) {
        const oldH = parseFloat(heightAttrMatch[1]);
        if (!isNaN(oldH)) {
          result = result.replace(
            `height="${heightAttrMatch[1]}"`,
            `height="${oldH + BRANDING_HEIGHT}"`
          );
        }
      }

      result = result.replace('</svg>', `${positioned}</svg>`);
      return result;
    }
  }

  // Fallback: no viewBox, try width/height attributes
  if (heightAttrMatch) {
    const widthMatch = svgHtml.match(/width="([^"]+)"/);
    const w = widthMatch ? parseFloat(widthMatch[1]) : 800;
    const h = parseFloat(heightAttrMatch[1]);
    if (!isNaN(h) && !isNaN(w)) {
      const textX = w - 4;
      const textY = h + BRANDING_HEIGHT - 6;
      const positioned = brandingText.replace('x="0" y="0"', `x="${textX}" y="${textY}"`);
      let result = svgHtml.replace(
        `height="${heightAttrMatch[1]}"`,
        `height="${h + BRANDING_HEIGHT}"`
      );
      result = result.replace('</svg>', `${positioned}</svg>`);
      return result;
    }
  }

  return svgHtml;
}
