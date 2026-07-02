import type { DiagnosticSpec } from './diagnostics';

/**
 * Declarative metadata for color diagnostics emitted as inline literals in
 * src/colors.ts. Color parsing is shared by every chart type, so these are
 * GLOBAL (chartType: null). Additive only — colors.ts remains the source of
 * truth for emission; this mirrors the wording + ACTUAL runtime severity.
 *
 * Note: E_INVALID_COLOR is emitted from three sites with slightly different
 * wording (trailing-token, hex/rgb/hsl literal, unknown-name) but a single
 * stable code. All three emit `warning` at runtime despite the `E_` prefix —
 * the library degrades gracefully (keeps the word) while the MCP render gate
 * blocks on the code. The canonical (trailing-token) wording is used below.
 */
export const COLOR_DIAGNOSTICS: DiagnosticSpec[] = [
  {
    // src/colors.ts:317/347/359 — makeDgmoError(..., 'warning', INVALID_COLOR_CODE='E_INVALID_COLOR')
    // Runtime: emitted as warning despite E_ prefix
    code: 'E_INVALID_COLOR',
    severity: 'warning',
    chartType: null,
    title: 'Invalid DGMO color',
    message: (p) =>
      `Color "${String(
        p.token ?? p.color ?? ''
      )}" is not a valid DGMO color — DGMO accepts only these 11 named colors: <names> (no hex, no CSS color names).`,
    hint: 'Use one of the 11 named palette colors instead of a hex/rgb()/hsl() or CSS color name.',
    example: `version-control
main
  Initial commit
develop from main crimson
  Set up CI
`,
  },
];
