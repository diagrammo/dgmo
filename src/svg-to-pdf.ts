/**
 * The CLI's PDF output: SVG in, a one-page PDF out.
 *
 * The same shape as the app's single-diagram PDF (`exportToPdf` in
 * diagrammo-app `src/lib/export.ts`): the diagram rasterised at `scale` and
 * placed as one image on a page the size of the canvas at 96 dpi, so a
 * 1200x800 canvas is a 900x600 pt page whatever the scale. PDF has no
 * transparency here, so the caller always passes an opaque background.
 *
 * Written by hand rather than through jsPDF: one image on one page is a few
 * hundred bytes of PDF syntax, and resvg already hands back raw pixels to
 * deflate. Bundled into the CLI only, like `svg-to-png.ts`.
 */
// cspell:ignore Flate endobj nendobj startxref nstartxref -- PDF syntax
import { deflateSync } from 'node:zlib';
import { rasterize, DEFAULT_PNG_SCALE } from './svg-to-png';

/** PDF points per CSS pixel: 72 pt per inch over 96 px per inch. */
const PT_PER_PX = 72 / 96;

export function svgToPdf(
  svg: string,
  background: string,
  scale: number = DEFAULT_PNG_SCALE
): Buffer {
  const image = rasterize(svg, background, scale);
  return pdfFromRgba(image.pixels, image.width, image.height, scale);
}

/**
 * One page holding one RGB image. `rgba` is `width * height * 4` bytes; the
 * alpha byte is dropped, since an opaque background leaves it 255 everywhere.
 * The page is `width / scale` CSS pixels wide, in points.
 */
export function pdfFromRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
  scale: number
): Buffer {
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgb[i] = rgba[j]!;
    rgb[i + 1] = rgba[j + 1]!;
    rgb[i + 2] = rgba[j + 2]!;
  }
  const data = deflateSync(rgb);
  const pageW = round((width / scale) * PT_PER_PX);
  const pageH = round((height / scale) * PT_PER_PX);
  const content = Buffer.from(`q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q\n`);

  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
        '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'
    ),
    stream(
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>`,
      data
    ),
    stream(`<< /Length ${content.length} >>`, content),
  ];

  const parts: Buffer[] = [
    Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1'),
  ];
  const offsets: number[] = [];
  let at = parts[0]!.length;
  objects.forEach((body, k) => {
    offsets.push(at);
    const obj = Buffer.concat([
      Buffer.from(`${k + 1} 0 obj\n`),
      body,
      Buffer.from('\nendobj\n'),
    ]);
    parts.push(obj);
    at += obj.length;
  });
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}

function stream(dict: string, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`${dict}\nstream\n`),
    data,
    Buffer.from('\nendstream'),
  ]);
}

/** Points to two decimals, without trailing zeros. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
