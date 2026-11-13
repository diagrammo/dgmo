// subset-font ships no types. Only the call `svg-embed-font.ts` makes.
declare module 'subset-font' {
  export default function subsetFont(
    font: Buffer,
    text: string,
    options?: { targetFormat?: 'woff2'; preserveNameIds?: number[] }
  ): Promise<Buffer>;
}
