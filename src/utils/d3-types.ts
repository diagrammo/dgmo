export interface D3ExportDimensions {
  width?: number;
  height?: number;
  /** Map-only: when true, the map renderer suppresses its global stretch-fill and
   *  contain-fits (letterbox) instead. Set by `mapExportDimensions` when the export
   *  canvas was clamped/floored away from the map's content aspect, so the
   *  off-aspect canvas doesn't re-distort. Ignored by all non-map renderers. */
  preferContain?: boolean;
}
