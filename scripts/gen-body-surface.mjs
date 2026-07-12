// Regenerate src/body/assets/surface.ts — the skin-mode surface-landmark
// catalog. Face features come from the head bbox, torso points from the
// neck/groin anchors, arm joints from biceps/forearm/hand centres; every point
// is snapped inside the silhouette so no landmark floats off the body.
//
//   node --experimental-strip-types scripts/gen-body-surface.mjs
import { FIGURES } from '../src/body/assets/figures.ts';
import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';

function mask(paths, viewBox) {
  const [vx, vy, vw, vh] = viewBox.split(' ').map(Number);
  const W = Math.round(vw),
    H = Math.round(vh);
  const d = paths.map((p) => `<path d="${p}" fill="black"/>`).join('');
  const img = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${viewBox}">${d}</svg>`
  ).render();
  const px = img.pixels,
    iw = img.width,
    ih = img.height;
  const on = new Uint8Array(iw * ih);
  let x0 = 1e9,
    y0 = 1e9,
    x1 = -1e9,
    y1 = -1e9,
    n = 0;
  for (let y = 0; y < ih; y++)
    for (let x = 0; x < iw; x++)
      if (px[(y * iw + x) * 4 + 3] > 10) {
        on[y * iw + x] = 1;
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  const toU = (x, y) => [vx + x * (vw / iw), vy + y * (vh / ih)];
  const toP = (ux, uy) => [
    Math.round((ux - vx) / (vw / iw)),
    Math.round((uy - vy) / (vh / ih)),
  ];
  return {
    on,
    iw,
    ih,
    toU,
    toP,
    bbox: n
      ? {
          x: toU(x0, y0)[0],
          y: toU(x0, y0)[1],
          w: toU(x1, y1)[0] - toU(x0, y0)[0],
          h: toU(x1, y1)[1] - toU(x0, y0)[1],
        }
      : null,
  };
}
const bboxOf = (paths, vb) => mask(paths, vb).bbox;
const R = (n) => Math.round(n);
function snapper(m) {
  return (ux, uy) => {
    let [px, py] = m.toP(ux, uy);
    px = Math.max(0, Math.min(m.iw - 1, px));
    py = Math.max(0, Math.min(m.ih - 1, py));
    if (m.on[py * m.iw + px]) return { x: R(ux), y: R(uy) };
    let best = Infinity,
      bx = px,
      by = py;
    for (let y = 0; y < m.ih; y += 2)
      for (let x = 0; x < m.iw; x += 2)
        if (m.on[y * m.iw + x]) {
          const dd = (x - px) ** 2 + (y - py) ** 2;
          if (dd < best) {
            best = dd;
            bx = x;
            by = y;
          }
        }
    const [ox, oy] = m.toU(bx, by);
    return { x: R(ox), y: R(oy) };
  };
}

function build(fk, fig) {
  const cb = fig.contentBox;
  const back = fk.includes('Back');
  const anc = (k) => fig.parts[k]?.anchor;
  const ctr = (k) => fig.parts[k]?.centers ?? (anc(k) ? [anc(k)] : null);
  const neck = anc('neck'),
    groin = anc('adductors');
  const mx = neck ? neck.x : cb.x + cb.w / 2;
  const snap = snapper(mask([fig.outline], fig.viewBox));
  const S = {};
  const bi = (lx, rx, y) => {
    const L = snap(lx, y),
      Rr = snap(rx, y);
    return {
      anchor: { x: R((L.x + Rr.x) / 2), y: R((L.y + Rr.y) / 2) },
      centers: [L, Rr],
    };
  };
  const mid = (x, y) => {
    const p = snap(x, y);
    return { anchor: p, centers: [p] };
  };

  const face = bboxOf(fig.headPaths, fig.viewBox);
  const head = bboxOf([...fig.headPaths, ...fig.hairPaths], fig.viewBox) || face;
  if (!back && face) {
    const { x, y, w, h } = face,
      fmx = x + w / 2;
    S.forehead = mid(fmx, y + 0.2 * h);
    S.eye = bi(fmx - 0.2 * w, fmx + 0.2 * w, y + 0.42 * h);
    S.nose = mid(fmx, y + 0.56 * h);
    S.cheek = bi(fmx - 0.28 * w, fmx + 0.28 * w, y + 0.64 * h);
    S.ear = bi(fmx - 0.52 * w, fmx + 0.52 * w, y + 0.48 * h);
    S.mouth = mid(fmx, y + 0.76 * h);
    S.jaw = bi(fmx - 0.34 * w, fmx + 0.34 * w, y + 0.88 * h);
    S.chin = mid(fmx, y + 0.97 * h);
  }
  if (back && head) {
    const { x, y, w, h } = head,
      hmx = x + w / 2;
    S.ear = bi(hmx - 0.46 * w, hmx + 0.46 * w, y + 0.45 * h);
  }
  if (neck && groin) {
    const span = groin.y - neck.y,
      cw = cb.w;
    if (!back) {
      S.throat = mid(mx, neck.y + 0.02 * span);
      S.collarbone = bi(mx - 0.11 * cw, mx + 0.11 * cw, neck.y + 0.05 * span);
      S.sternum = mid(mx, neck.y + 0.28 * span);
      S.belly = mid(mx, neck.y + 0.56 * span);
      S.navel = mid(mx, neck.y + 0.66 * span);
      S.hip = bi(mx - 0.055 * cw, mx + 0.055 * cw, neck.y + 0.79 * span);
      S.groin = mid(mx, groin.y + 0.02 * span);
    } else {
      S.nape = mid(mx, neck.y - 0.02 * span);
      S['shoulder-blade'] = bi(
        mx - 0.12 * cw,
        mx + 0.12 * cw,
        neck.y + 0.16 * span
      );
      S.spine = mid(mx, neck.y + 0.42 * span);
      S.hip = bi(mx - 0.08 * cw, mx + 0.08 * cw, neck.y + 0.76 * span);
      S.tailbone = mid(mx, neck.y + 0.86 * span);
    }
  }
  const bic = ctr('biceps'),
    fore = ctr('forearm'),
    hand = ctr('hands');
  const pair = (a, b, t) => {
    if (!a || !b) return null;
    const al = [...a].sort((p, q) => p.x - q.x),
      bl = [...b].sort((p, q) => p.x - q.x);
    const n = Math.min(al.length, bl.length);
    if (n < 2) return null;
    const L = snap(
      al[0].x + (bl[0].x - al[0].x) * t,
      al[0].y + (bl[0].y - al[0].y) * t
    );
    const Rr = snap(
      al[n - 1].x + (bl[n - 1].x - al[n - 1].x) * t,
      al[n - 1].y + (bl[n - 1].y - al[n - 1].y) * t
    );
    return {
      anchor: { x: R((L.x + Rr.x) / 2), y: R((L.y + Rr.y) / 2) },
      centers: [L, Rr],
    };
  };
  const elbow = back ? null : pair(bic, fore, 0.1);
  if (elbow) S.elbow = elbow;
  const wrist = fore && hand ? pair(fore, hand, 0.75) : null;
  if (wrist) S.wrist = wrist;
  return S;
}

const out = {};
for (const [fk, fig] of Object.entries(FIGURES)) out[fk] = build(fk, fig);
const ser = (g) =>
  `{ anchor: { x: ${g.anchor.x}, y: ${g.anchor.y} }, centers: [${g.centers
    .map((c) => `{ x: ${c.x}, y: ${c.y} }`)
    .join(', ')}] }`;
let body = '';
for (const [fk, S] of Object.entries(out)) {
  body += `  ${fk}: {\n`;
  for (const [k, g] of Object.entries(S)) {
    const key = /[^a-z]/.test(k) ? `'${k}'` : k;
    body += `    ${key}: ${ser(g)},\n`;
  }
  body += `  },\n`;
}
const file = `// ============================================================
// Body chart — surface landmark catalog (skin-mode point features)
// ============================================================
//
// GENERATED by scripts/gen-body-surface.mjs — do not edit by hand.
// Face features from the head bbox, torso points from the neck / groin anchors,
// arm joints interpolated from biceps/forearm/hand centres, every point snapped
// inside the silhouette. Leader-only anchors (no fill); a \`left\`/\`right\`
// modifier selects a bilateral landmark's side via \`centers\`.

import type { BodyPartGeometry, FigureKey } from '../types';

type SurfaceGeom = Omit<BodyPartGeometry, 'paths'>;

export const SURFACE: Readonly<Record<FigureKey, Record<string, SurfaceGeom>>> = {
${body}};
`;
fs.writeFileSync(
  new URL('../src/body/assets/surface.ts', import.meta.url),
  file
);
console.log('wrote src/body/assets/surface.ts');
