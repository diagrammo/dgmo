// Number labels are drawn as one `<tspan x>` per digit cell (#2035). Tests
// that read a label's text out of the SVG string with a regex call this
// first: it folds each such run of cell tspans back into the plain string.
// Positions are untouched — the element's `x` is the label's centre and its
// anchor is `middle`.
const CELL_RUN = /((?:<tspan x="[\d.-]+">[^<]*<\/tspan>)+)<\/text>/g;

export function flattenTabular(svg: string): string {
  return svg.replace(
    CELL_RUN,
    (_, run: string) =>
      run.replace(/<tspan x="[\d.-]+">([^<]*)<\/tspan>/g, '$1') + '</text>'
  );
}
