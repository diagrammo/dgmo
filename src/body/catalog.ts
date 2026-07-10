// ============================================================
// Body chart — figure selection + anatomy name resolution
// ============================================================
//
// Picks the figure asset for a (sex, view) and maps user-typed part names
// (formal anatomical OR gym shorthand) to a canonical catalog key present in
// that figure. Shared by the parser (unknown-part validation) and the renderer
// (geometry lookup). Lifted from the prototype's ANATOMICAL + MUS_ALIAS maps.

import { FIGURES } from './assets/figures';
import type { BodyFigure, BodySex, BodyView, FigureKey } from './types';

export function figureKey(sex: BodySex, view: BodyView): FigureKey {
  return `${sex}${view === 'front' ? 'Front' : 'Back'}` as FigureKey;
}

export function getFigure(sex: BodySex, view: BodyView): BodyFigure {
  return FIGURES[figureKey(sex, view)];
}

/** Formal anatomical names → catalog canonical. */
const ANATOMICAL: Readonly<Record<string, string>> = {
  'pectoralis-major': 'chest',
  pectoralis: 'chest',
  'rectus-abdominis': 'abs',
  abdominals: 'abs',
  'biceps-brachii': 'biceps',
  'triceps-brachii': 'triceps',
  'quadriceps-femoris': 'quadriceps',
  'external-oblique': 'obliques',
  gastrocnemius: 'calves',
  'latissimus-dorsi': 'lats',
  latissimus: 'lats',
  'gluteus-maximus': 'glute-maximus',
  'gluteus-medius': 'glute-medius',
  'erector-spinae': 'erector-spinae',
  'quadratus-lumborum': 'quadratus-lumborum',
  'biceps-femoris': 'biceps-femoris',
  'anterior-deltoid': 'front-delts',
  'lateral-deltoid': 'side-delts',
  'posterior-deltoid': 'rear-delts',
};

/** Gym shorthand + fine-name fallbacks → catalog canonical. */
const ALIAS: Readonly<Record<string, string>> = {
  pecs: 'chest',
  pec: 'chest',
  delts: 'deltoids',
  delt: 'deltoids',
  shoulders: 'deltoids',
  quads: 'quadriceps',
  quad: 'quadriceps',
  bicep: 'biceps',
  bis: 'biceps',
  tricep: 'triceps',
  tris: 'triceps',
  calf: 'calves',
  traps: 'trapezius',
  trap: 'trapezius',
  shins: 'tibialis',
  serratus: 'serratus-anterior',
  lat: 'lats',
  glutes: 'gluteal',
  glute: 'gluteal',
  butt: 'gluteal',
  hamstrings: 'hamstring',
  hams: 'hamstring',
  'lower-back': 'lower-back',
  'upper-back': 'upper-back',
};

/**
 * Normalize a user-typed name to a catalog key present in `figure`, or null.
 * Tries: verbatim, whole-muscle group name, formal anatomical, gym shorthand.
 */
export function resolvePartKey(
  figure: BodyFigure,
  name: string
): string | null {
  const n = name.toLowerCase();
  if (figure.parts[n]) return n;
  const anat = ANATOMICAL[n];
  if (anat && figure.parts[anat]) return anat;
  const al = ALIAS[n];
  if (al && figure.parts[al]) return al;
  // Fine delt names fall back to the whole deltoid where the art isn't split.
  if (
    (n === 'front-delts' || n === 'side-delts' || n === 'rear-delts') &&
    figure.parts['deltoids']
  )
    return 'deltoids';
  return null;
}
