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

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Device-pixel multiplier for the copied PNG — matches the app's PNG export. */
const COPY_IMAGE_SCALE = 2;

/** True when this browser can put a PNG on the clipboard. Hide the button if not. */
export function canCopyDiagramImage(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  );
}

/**
 * Copy the diagram in the `.dgmo` block containing `fromButton` to the
 * clipboard as a PNG. Resolves false on any failure (no SVG, a tainted canvas
 * from an external `<image>`, a refused clipboard) — never throws.
 */
export function copyDiagramImage(fromButton: Element): Promise<boolean> {
  if (!canCopyDiagramImage()) return Promise.resolve(false);
  const found = visibleSvg(fromButton);
  if (!found) return Promise.resolve(false);
  try {
    return navigator.clipboard
      .write([
        new ClipboardItem({
          'image/png': svgToPngBlob(found.svg, found.background),
        }),
      ])
      .then(
        () => true,
        () => false
      );
  } catch {
    return Promise.resolve(false);
  }
}

function visibleSvg(
  fromButton: Element
): { svg: SVGSVGElement; background: string | undefined } | null {
  const block = fromButton.closest('.dgmo');
  if (!block) return null;
  const view = block.ownerDocument.defaultView ?? window;
  const wrappers = block.querySelectorAll<HTMLElement>(
    '.dgmo-light, .dgmo-dark, .dgmo-svg'
  );
  for (const w of Array.from(wrappers)) {
    if (view.getComputedStyle(w).display === 'none') continue;
    const svg = w.querySelector('svg');
    if (svg) {
      return { svg, background: w.dataset['dgmoBg'] ?? pageBackground(w) };
    }
  }
  const svg = block.querySelector('svg');
  return svg ? { svg, background: pageBackground(block) } : null;
}

/**
 * The colour the diagram is actually sitting on — the auto script's slot has no
 * `data-dgmo-bg`, so walk up to the first opaque ancestor background.
 */
function pageBackground(from: Element): string | undefined {
  const view = from.ownerDocument.defaultView ?? window;
  for (let el: Element | null = from; el; el = el.parentElement) {
    const bg = view.getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(bg)) return bg;
  }
  return undefined;
}

/** Intrinsic size in CSS px: viewBox first (embeds set width="100%"), then layout. */
function intrinsicSize(svg: SVGSVGElement): { width: number; height: number } {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    return { width: vb.width, height: vb.height };
  }
  const rect = svg.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

async function svgToPngBlob(
  svg: SVGSVGElement,
  background: string | undefined
): Promise<Blob> {
  const { width, height } = intrinsicSize(svg);
  if (!(width > 0 && height > 0)) throw new Error('diagram has no size');

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  // Embed sizing (width:100%, aspect-ratio, max-width) means nothing standalone.
  // 🔴 Only the sizing properties: the root `style` also carries the diagram's
  // font-family, and dropping it pastes every label in the default serif.
  for (const prop of ['width', 'height', 'max-width', 'aspect-ratio']) {
    clone.style.removeProperty(prop);
  }
  const xml = new XMLSerializer().serializeToString(clone);

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('diagram SVG failed to load'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * COPY_IMAGE_SCALE);
  canvas.height = Math.round(height * COPY_IMAGE_SCALE);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas context');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/png'
    );
  });
}
