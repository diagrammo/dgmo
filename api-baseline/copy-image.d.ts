/**
 * Copy-as-image for the embed toolbar's `.dgmo-copy-image` button — its own
 * zero-import entry (`@diagrammo/dgmo/copy-image`) so every client surface
 * (the auto script, remark-dgmo's `bindDgmo`, the Obsidian plugin) shares ONE
 * rasterizer instead of mirroring it the way copy-source is mirrored.
 *
 * Copies the diagram as it is currently shown — the visible `.dgmo-light` /
 * `.dgmo-dark` half of a dual render, or the single `.dgmo-svg` — as a PNG at
 * `COPY_IMAGE_SCALE`, filled with the wrapper's `data-dgmo-bg` so a transparent
 * embed doesn't paste as dark text on nothing.
 *
 * 🔴 `navigator.clipboard.write` must be CALLED inside the click, before any
 * await: Safari drops the user activation across an await and then refuses the
 * write. Hence the Blob goes in as a Promise and the PNG is drawn inside
 * the ClipboardItem.
 *
 * Fonts: an SVG drawn through `<img>` cannot load web fonts. dgmo draws text in
 * a system font stack, so labels still match; a host font injected by page CSS
 * would not survive.
 */
/**
 * True when this browser can put a PNG on the clipboard. Hide the button if not.
 * Pass the block's own window for a pop-out (Obsidian): the write is refused
 * unless it goes through the window whose document has focus.
 */
declare function canCopyDiagramImage(view?: Window | null): boolean;
/**
 * Copy the diagram in the `.dgmo` block containing `fromButton` to the
 * clipboard as a PNG. Resolves false on any failure (no SVG, a tainted canvas
 * from an external `<image>`, a refused clipboard) — never throws.
 */
declare function copyDiagramImage(fromButton: Element): Promise<boolean>;

export { canCopyDiagramImage, copyDiagramImage };
