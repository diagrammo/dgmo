export const FONT_FAMILY =
  'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif';
export const DEFAULT_FONT_NAME = 'Inter';

// Distance from a line's vertical centre DOWN to its alphabetic baseline, in
// em. Add it to the y you want the text centred on.
//
// This is the number `dominant-baseline: central` computes. We do the sum by
// hand wherever the text must survive export, because WebKit drops the
// attribute on <text> and resvg supports only part of it — so the attribute is
// safe on screen and silently wrong in a PNG.
//
// Read off `fonts/Inter-Regular.ttf`: ascender 1984/2048, descender -494/2048,
// so half their span is 0.3638em. Inter's OS/2 sCapHeight (1490/2048) halves to
// the same figure, which is why capital-height centring and em-box centring
// agree here and one constant serves both.
export const FONT_CENTRAL_DY = 0.3638;
