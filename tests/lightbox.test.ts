import { describe, it, expect, beforeAll, afterEach } from 'vitest';

import { openDgmoLightbox } from '../src/auto/shared';

// jsdom (as of the version vitest bundles) does not implement the <dialog>
// modal methods. openDgmoLightbox relies on showModal()/close(); polyfill the
// minimum surface so the helper's DOM effects can be asserted.
beforeAll(() => {
  const proto = window.HTMLDialogElement?.prototype as
    | (HTMLDialogElement & { showModal: () => void })
    | undefined;
  if (proto && typeof proto.showModal !== 'function') {
    proto.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
    proto.close = function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }
});

afterEach(() => {
  document.body.innerHTML = '';
  document.querySelectorAll('dialog.dgmo-lightbox').forEach((d) => d.remove());
});

function mountBlock(inner: string): HTMLElement {
  const fig = document.createElement('figure');
  fig.className = 'dgmo dgmo--showcase';
  fig.innerHTML = inner;
  document.body.appendChild(fig);
  return fig;
}

const SVG = (id = 'grad') =>
  `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">` +
  `<defs><linearGradient id="${id}"><stop offset="0"/></linearGradient></defs>` +
  `<rect width="100" height="100" fill="url(#${id})"/></svg>`;

describe('openDgmoLightbox', () => {
  it('opens a modal <dialog> containing a clone of the diagram', () => {
    const fig = mountBlock(
      `<div class="dgmo-svg">${SVG()}</div>` +
        `<details class="dgmo-source-wrap"><summary class="dgmo-toolbar">` +
        `<button type="button" class="dgmo-toolbar-btn dgmo-expand"></button>` +
        `</summary></details>`
    );
    const btn = fig.querySelector('.dgmo-expand')!;
    openDgmoLightbox(btn);

    const dialog = document.querySelector('dialog.dgmo-lightbox');
    expect(dialog).not.toBeNull();
    expect((dialog as HTMLDialogElement).open).toBe(true);
    expect(dialog!.querySelector('.dgmo-lightbox-svg svg')).not.toBeNull();
    expect(dialog!.querySelector('.dgmo-lightbox-close')).not.toBeNull();
  });

  it('namespaces cloned ids so they cannot clash with the inline copy', () => {
    const fig = mountBlock(
      `<div class="dgmo-svg">${SVG('grad')}</div>` +
        `<button class="dgmo-toolbar-btn dgmo-expand"></button>`
    );
    openDgmoLightbox(fig.querySelector('.dgmo-expand')!);

    const dialog = document.querySelector('dialog.dgmo-lightbox')!;
    const gradient = dialog.querySelector('linearGradient')!;
    // id was rewritten off the original "grad"
    expect(gradient.id).not.toBe('grad');
    expect(gradient.id.endsWith('grad')).toBe(true);
    // and the url(#…) reference was remapped to the new id
    const rect = dialog.querySelector('rect')!;
    expect(rect.getAttribute('fill')).toBe(`url(#${gradient.id})`);
  });

  it('clones the visible color mode under dual render', () => {
    const fig = mountBlock(
      `<div class="dgmo-light" style="display:block">${SVG('lite')}</div>` +
        `<div class="dgmo-dark" style="display:none">${SVG('drk')}</div>` +
        `<button class="dgmo-toolbar-btn dgmo-expand"></button>`
    );
    openDgmoLightbox(fig.querySelector('.dgmo-expand')!);

    const dialog = document.querySelector('dialog.dgmo-lightbox')!;
    // the light gradient id (namespaced) should be present, not the dark one
    expect(dialog.querySelector('linearGradient')!.id.endsWith('lite')).toBe(
      true
    );
  });

  it('close button dismisses and removes the dialog', () => {
    const fig = mountBlock(
      `<div class="dgmo-svg">${SVG()}</div>` +
        `<button class="dgmo-toolbar-btn dgmo-expand"></button>`
    );
    openDgmoLightbox(fig.querySelector('.dgmo-expand')!);
    const dialog = document.querySelector(
      'dialog.dgmo-lightbox'
    ) as HTMLDialogElement | null;
    expect(dialog).not.toBeNull();
    (dialog!.querySelector('.dgmo-lightbox-close') as HTMLElement).click();
    expect(document.querySelector('dialog.dgmo-lightbox')).toBeNull();
  });

  it('is a no-op when the block has no svg', () => {
    const fig = mountBlock(
      `<div class="dgmo-svg"></div>` +
        `<button class="dgmo-toolbar-btn dgmo-expand"></button>`
    );
    openDgmoLightbox(fig.querySelector('.dgmo-expand')!);
    expect(document.querySelector('dialog.dgmo-lightbox')).toBeNull();
  });
});
