// ============================================================
// Countdown chart — cell hover readout (#2428)
// ============================================================
//
// Every band cell is a `<g data-dgmo-cd-cell="…">` carrying what it stands for
// ("2031 · 5 years away"), baked by the renderer. The highlight itself (cell
// outline, row-label emphasis) is pure CSS in the renderer's baked `<style>`,
// so it works on every surface with no JS. Only the readout line needs JS: SVG
// text cannot take its content from CSS. This module fills the fixed readout
// line (`[data-dgmo-cd-readout]`, empty at rest) from the hovered cell.
//
// The listener sits on the `<svg>` root and reads the DOM at hover time, so it
// survives ./redraw, which swaps the root's children but keeps the root. Both
// the renderer (live DOM render) and the ticker (every live host) call it;
// it installs once per root.

const INSTALLED = '__dgmoCountdownHover';

/** The readout text for a hovered cell; a clock gauge reads its live value. */
export function cellReadout(cell: Element): string {
  const label = cell.getAttribute('data-dgmo-cd-cell') ?? '';
  const gauge = cell.getAttribute('data-dgmo-cd-gauge');
  if (gauge === null) return label;
  const val = cell.querySelector('[data-dgmo-gauge-val]')?.textContent ?? '';
  const svg = cell.closest('svg');
  const caption =
    svg?.querySelector('[data-dgmo-gauge-caption]')?.textContent ?? '';
  return [`${val} ${label}`.trim(), caption.toLowerCase()]
    .filter(Boolean)
    .join(' ');
}

/** Wire the hover readout on a countdown `<svg>`. Idempotent. */
export function installCountdownHover(svg: Element): void {
  const flagged = svg as Element & { [INSTALLED]?: boolean };
  if (flagged[INSTALLED]) return;
  flagged[INSTALLED] = true;
  const write = (txt: string): void => {
    const out = svg.querySelector('[data-dgmo-cd-readout]');
    if (out && out.textContent !== txt) out.textContent = txt;
  };
  svg.addEventListener('mouseover', (e) => {
    const t = e.target as Element | null;
    const cell = t?.closest?.('[data-dgmo-cd-cell]') ?? null;
    write(cell ? cellReadout(cell) : '');
  });
  svg.addEventListener('mouseleave', () => write(''));
}
