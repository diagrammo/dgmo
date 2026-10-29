import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canCopyDiagramImage, copyDiagramImage } from '../src/embed/copy-image';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" width="100%"><rect width="120" height="60"/></svg>`;

/** A dual-render block: light visible, dark hidden by inline style. */
function mountBlock(): HTMLButtonElement {
  document.body.innerHTML =
    `<figure class="dgmo">` +
    `<div class="dgmo-light" data-dgmo-bg="#fafafa">${SVG}</div>` +
    `<div class="dgmo-dark" data-dgmo-bg="#111111" style="display:none">${SVG}</div>` +
    `<div class="dgmo-source-wrap"><div class="dgmo-toolbar">` +
    `<button type="button" class="dgmo-toolbar-btn dgmo-copy-image"></button>` +
    `</div></div></figure>`;
  return document.querySelector('button')!;
}

class FakeClipboardItem {
  constructor(readonly items: Record<string, Promise<Blob>>) {}
}

describe('copyDiagramImage', () => {
  let write: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    write = vi.fn(() => Promise.resolve());
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    Object.defineProperty(navigator, 'clipboard', {
      value: { write },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
    document.body.innerHTML = '';
  });

  it('calls clipboard.write synchronously with a PNG promise (Safari gesture rule)', () => {
    const btn = mountBlock();
    void copyDiagramImage(btn);
    // No await between the click and write(): Safari would drop the gesture.
    expect(write).toHaveBeenCalledTimes(1);
    const [items] = write.mock.calls[0] as [FakeClipboardItem[]];
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]!.items)).toEqual(['image/png']);
    expect(items[0]!.items['image/png']).toBeInstanceOf(Promise);
    // jsdom cannot rasterize; swallow the inner rejection.
    items[0]!.items['image/png']!.catch(() => {});
  });

  it('keeps the root font-family and drops only embed sizing', async () => {
    let src = '';
    vi.stubGlobal(
      'Image',
      class {
        onerror: (() => void) | null = null;
        set src(v: string) {
          src = v;
          this.onerror?.(); // stop before the canvas, which jsdom lacks
        }
      }
    );
    const btn = mountBlock();
    btn
      .closest('.dgmo')!
      .querySelector('.dgmo-light svg')!
      .setAttribute(
        'style',
        'font-family: Inter, sans-serif; width: 100%; aspect-ratio: 2 / 1'
      );
    void copyDiagramImage(btn);
    const [items] = write.mock.calls[0] as [FakeClipboardItem[]];
    await items[0]!.items['image/png']!.catch(() => {});
    const xml = decodeURIComponent(src.split(',')[1]!);
    expect(xml).toContain('font-family: Inter, sans-serif');
    expect(xml).not.toContain('aspect-ratio');
    expect(xml).toContain('width="120"');
  });

  it('resolves false when the clipboard refuses', async () => {
    write.mockImplementation(() => Promise.reject(new Error('denied')));
    const btn = mountBlock();
    await expect(copyDiagramImage(btn)).resolves.toBe(false);
  });

  it('resolves false outside a .dgmo block', async () => {
    document.body.innerHTML = '<button></button>';
    await expect(
      copyDiagramImage(document.querySelector('button')!)
    ).resolves.toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('reports unsupported when ClipboardItem is missing', () => {
    expect(canCopyDiagramImage()).toBe(true);
    vi.stubGlobal('ClipboardItem', undefined);
    expect(canCopyDiagramImage()).toBe(false);
  });
});
